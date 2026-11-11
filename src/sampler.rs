//! Takes host samples away from the cooperative module tick.
//!
//! Sampling reads procfs and sysfs and calls NVML, and each of those can take
//! milliseconds while a game holds the GPU. The host ticks every module on one
//! thread, so sampling inline stalls video delivery at the polling rate.
use crate::{model::HostSnapshot, provider::Provider};
use std::{
    sync::mpsc::{Receiver, SyncSender, TryRecvError, TrySendError, sync_channel},
    thread::{self, JoinHandle},
    time::Instant,
};

enum Request {
    Sample(Instant),
    ResetBaselines,
}

/// One sample and one baseline reset can be outstanding at the same time.
const REQUEST_CAPACITY: usize = 2;
const RESULT_CAPACITY: usize = 1;

struct Background {
    requests: Option<SyncSender<Request>>,
    results: Option<Receiver<HostSnapshot>>,
    diagnostics: Option<Receiver<Vec<String>>>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for Background {
    fn drop(&mut self) {
        // Close both directions so a worker blocked on either one exits.
        self.requests.take();
        self.results.take();
        self.diagnostics.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum Backend {
    Background(Background),
    #[cfg(test)]
    Inline(Box<Inline>),
}

#[cfg(test)]
struct Inline {
    provider: Provider,
    finished: Option<HostSnapshot>,
}

pub(crate) struct Sampler {
    backend: Backend,
    busy: bool,
    baselines_dirty: bool,
    pending_diagnostics: std::collections::VecDeque<String>,
}

impl Sampler {
    #[cfg(not(test))]
    pub(crate) fn new() -> Self {
        Self::background()
    }

    /// Unit tests observe each tick's sample without waiting for a thread.
    #[cfg(test)]
    pub(crate) fn new() -> Self {
        Self::with_backend(Backend::Inline(Box::new(Inline {
            provider: Provider::new(),
            finished: None,
        })))
    }

    fn with_backend(backend: Backend) -> Self {
        Self {
            backend,
            busy: false,
            baselines_dirty: false,
            pending_diagnostics: std::collections::VecDeque::new(),
        }
    }

    /// A worker that cannot start leaves metrics unavailable; streaming and
    /// every other module are unaffected.
    fn background() -> Self {
        let (requests, queued) = sync_channel::<Request>(REQUEST_CAPACITY);
        let (finished, results) = sync_channel::<HostSnapshot>(RESULT_CAPACITY);
        let (diagnostics_tx, diagnostics) = sync_channel::<Vec<String>>(1);
        let worker = thread::Builder::new()
            .name("host-metrics".into())
            .spawn(move || run(&queued, &finished, &diagnostics_tx))
            .ok();
        Self::with_backend(Backend::Background(Background {
            requests: Some(requests),
            results: Some(results),
            diagnostics: Some(diagnostics),
            worker,
        }))
    }

    pub(crate) fn take_diagnostics(&mut self) -> Vec<String> {
        let receiver = match &self.backend {
            Backend::Background(background) => background.diagnostics.as_ref(),
            #[cfg(test)]
            Backend::Inline(_) => None,
        };
        if self.pending_diagnostics.is_empty()
            && let Some(receiver) = receiver
            && let Ok(reports) = receiver.try_recv()
        {
            self.pending_diagnostics
                .extend(reports.into_iter().take(32));
        }
        let count = self.pending_diagnostics.len().min(4);
        self.pending_diagnostics.drain(..count).collect()
    }

    pub(crate) fn busy(&self) -> bool {
        self.busy
    }

    pub(crate) fn request(&mut self, now: Instant) {
        if self.busy {
            return;
        }
        self.baselines_dirty = true;
        match &mut self.backend {
            Backend::Background(background) => {
                if offer(background, Request::Sample(now)) {
                    self.busy = true;
                }
            }
            #[cfg(test)]
            Backend::Inline(inline) => {
                inline.finished = Some(inline.provider.sample(now));
                self.busy = true;
            }
        }
    }

    pub(crate) fn poll(&mut self) -> Option<HostSnapshot> {
        let finished = match &mut self.backend {
            Backend::Background(background) => {
                let results = background.results.as_ref()?;
                match results.try_recv() {
                    Ok(snapshot) => Some(snapshot),
                    Err(TryRecvError::Empty) => None,
                    Err(TryRecvError::Disconnected) => {
                        self.busy = false;
                        None
                    }
                }
            }
            #[cfg(test)]
            Backend::Inline(inline) => inline.finished.take(),
        };
        if finished.is_some() {
            self.busy = false;
        }
        finished
    }

    /// Idempotent: called on every idle tick, but sent only after sampling.
    pub(crate) fn reset_rate_baselines(&mut self) {
        if !self.baselines_dirty {
            return;
        }
        match &mut self.backend {
            Backend::Background(background) => {
                if offer(background, Request::ResetBaselines) {
                    self.baselines_dirty = false;
                }
            }
            #[cfg(test)]
            Backend::Inline(inline) => {
                inline.provider.reset_rate_baselines();
                self.baselines_dirty = false;
            }
        }
    }
}

fn offer(background: &Background, request: Request) -> bool {
    let Some(requests) = &background.requests else {
        return false;
    };
    match requests.try_send(request) {
        Ok(()) => true,
        Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => false,
    }
}

/// The provider is created here because its NVML handles stay on one thread.
fn run(
    queued: &Receiver<Request>,
    finished: &SyncSender<HostSnapshot>,
    diagnostics: &SyncSender<Vec<String>>,
) {
    let mut provider = Provider::new();
    let mut dropped = 0u64;
    while let Ok(request) = queued.recv() {
        match request {
            Request::Sample(now) => {
                let snapshot = provider.sample(now);
                let reports = crate::stream_diagnostics::collect(&snapshot, dropped);
                if diagnostics.try_send(reports).is_err() {
                    dropped = dropped.saturating_add(1);
                }
                if finished.send(snapshot).is_err() {
                    return;
                }
            }
            Request::ResetBaselines => provider.reset_rate_baselines(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_background_sample_arrives_without_the_caller_waiting_for_it() {
        let mut sampler = Sampler::background();

        sampler.request(Instant::now());
        assert!(sampler.busy());

        let deadline = Instant::now() + Duration::from_secs(10);
        while sampler.poll().is_none() {
            assert!(Instant::now() < deadline, "sample never arrived");
            thread::sleep(Duration::from_millis(1));
        }
        assert!(!sampler.busy());
    }

    #[test]
    fn dropping_with_an_unread_sample_retires_the_worker() {
        let mut sampler = Sampler::background();
        sampler.request(Instant::now());
        drop(sampler);
    }

    #[test]
    fn baselines_are_reset_only_after_sampling_has_run() {
        let mut sampler = Sampler::background();
        sampler.reset_rate_baselines();
        assert!(!sampler.baselines_dirty);

        sampler.request(Instant::now());
        assert!(sampler.baselines_dirty);
        sampler.reset_rate_baselines();
        assert!(!sampler.baselines_dirty);
    }
}

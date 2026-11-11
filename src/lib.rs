//! Demand-driven host telemetry and its revisioned management preferences.
pub mod api;
mod collector;
mod model;
mod nvidia;
mod product_settings;
mod provider;
mod sampler;
mod stream_diagnostics;
#[cfg(any(target_os = "windows", feature = "windows-platform-check"))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows;
#[cfg(any(target_os = "windows", feature = "windows-platform-check"))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_dxgi;
#[cfg(any(target_os = "windows", feature = "windows-platform-check"))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_gpu;

use amaterasu_module_sdk::{Command, ManagedModule, ModuleResult, Response, RuntimeClient};
use collector::Collector;
use model::Settings;
use product_settings::{Completion, ProductSettings};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const SERVICE: &str = "amaterasu.host-metrics/1";
const MANAGEMENT: &str = "amaterasu.management";
const STREAM_SESSION: &str = "amaterasu.stream-session";

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
    SettingsGet {},
    SettingsUpdate {
        settings: Settings,
        expected_revision: u64,
    },
    StatsRead {},
    StreamActivityBegin {
        session_id: String,
    },
    StreamActivityEnd {
        session_id: String,
    },
}

struct HostMetricsModule {
    runtime: RuntimeClient,
    product_settings: ProductSettings,
    collector: Collector,
    deferred_settings: VecDeque<(u64, Operation)>,
    pending_completions: VecDeque<(u64, Value)>,
    shutting_down: bool,
}

impl ManagedModule for HostMetricsModule {
    fn start(runtime: RuntimeClient) -> ModuleResult<Self> {
        runtime.require_success(Command::Register {
            service: SERVICE.into(),
        })?;
        amaterasu_module_sdk::operation_api::register_selected(&runtime, &api::methods())?;
        let startup_id = format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let settings = Settings::default();
        Ok(Self {
            runtime,
            product_settings: ProductSettings::new(&startup_id),
            collector: Collector::new(settings),
            deferred_settings: VecDeque::new(),
            pending_completions: VecDeque::new(),
            shutting_down: false,
        })
    }

    fn quiesce(&mut self) -> ModuleResult<bool> {
        if !self.shutting_down {
            self.shutting_down = true;
            self.product_settings.begin_shutdown();
            while let Some((request, _)) = self.deferred_settings.pop_front() {
                self.complete(
                    request,
                    failure("shutting_down", "host metrics is shutting down"),
                )?;
            }
        }
        Ok(self.product_settings.shutdown_ready() && self.pending_completions.is_empty())
    }

    fn tick(&mut self) -> ModuleResult<()> {
        if !self.shutting_down
            && self.pending_completions.is_empty()
            && let Response::Request {
                id,
                caller,
                service,
                payload,
                ..
            } = self.runtime.send(Command::Poll {})?
        {
            match amaterasu_module_sdk::operation_api::decode_delivery(
                payload,
                &service,
                SERVICE,
                &api::methods(),
            )
            .and_then(|payload| {
                serde_json::from_value::<Operation>(payload).map_err(|e| e.to_string())
            }) {
                Ok(operation) => {
                    self.handle_request(id, &caller, operation, service == "nonary.stats/1")?
                }
                Err(_) => self.complete(
                    id,
                    failure(
                        "invalid_request",
                        "request does not match the host metrics schema",
                    ),
                )?,
            }
        }

        let runtime = &mut self.runtime;
        self.product_settings
            .advance(&mut |command| runtime.send(command))?;
        while let Some(completion) = self.product_settings.take_completion() {
            match completion {
                Completion::Update { request, response } => {
                    if response.get("ok").and_then(Value::as_bool) == Some(true) {
                        let (settings, _) = self.product_settings.settings();
                        self.collector
                            .apply_settings(settings.clone(), Instant::now());
                    }
                    self.complete(request, response)?;
                }
            }
        }

        if self.product_settings.is_ready() {
            let (settings, _) = self.product_settings.settings();
            if self.collector.settings() != settings {
                self.collector
                    .apply_settings(settings.clone(), Instant::now());
            }
        }
        self.collector.tick(Instant::now());
        for report in self.collector.take_diagnostics() {
            let _ = self
                .runtime
                .log(amaterasu_module_sdk::LogLevel::Info, "host.timing", &report);
        }
        self.drain_deferred_settings()?;
        flush_completions(&mut self.pending_completions, &mut |command| {
            self.runtime.send(command)
        });
        Ok(())
    }
}

impl HostMetricsModule {
    fn handle_request(
        &mut self,
        id: u64,
        caller: &str,
        operation: Operation,
        approved_api: bool,
    ) -> ModuleResult<()> {
        match operation {
            Operation::SettingsGet {} if caller == MANAGEMENT || approved_api => {
                if !self.product_settings.is_ready() {
                    if self.deferred_settings.len() >= 32 {
                        return self.complete(
                            id,
                            failure(
                                "settings_busy",
                                "too many host metrics settings reads are queued",
                            ),
                        );
                    }
                    self.deferred_settings
                        .push_back((id, Operation::SettingsGet {}));
                    return Ok(());
                }
                let (settings, revision) = self.product_settings.settings();
                self.complete(
                    id,
                    json!({"ok":true,"settings":settings,"revision":revision}),
                )
            }
            Operation::SettingsGet {} => self.complete(
                id,
                failure(
                    "permission_denied",
                    "caller is not authorized for host metrics settings",
                ),
            ),
            Operation::SettingsUpdate {
                settings,
                expected_revision,
            } if caller == MANAGEMENT || approved_api => {
                match self
                    .product_settings
                    .begin_update(id, expected_revision, settings)
                {
                    Ok(()) => Ok(()),
                    Err(response) => self.complete(id, response),
                }
            }
            Operation::SettingsUpdate { .. } => self.complete(
                id,
                failure(
                    "permission_denied",
                    "caller is not authorized for host metrics settings",
                ),
            ),
            Operation::StatsRead {} if caller == MANAGEMENT || approved_api => {
                let (available, sampled_at_unix, host, samples) =
                    self.collector.read(Instant::now());
                self.complete(
                    id,
                    json!({
                        "ok":true,
                        "available":available,
                        "platform":self.collector.platform(),
                        "sampled_at_unix_ms":sampled_at_unix,
                        "host":host,
                        "samples":samples
                    }),
                )
            }
            Operation::StatsRead {} => self.complete(
                id,
                failure(
                    "permission_denied",
                    "caller is not authorized to read host metrics",
                ),
            ),
            Operation::StreamActivityBegin { session_id } if caller == STREAM_SESSION => {
                match self.collector.stream_activity_begin(&session_id) {
                    Ok(()) => self.complete(id, json!({"ok":true,"active":true})),
                    Err(message) => self.complete(id, failure("invalid_request", message)),
                }
            }
            Operation::StreamActivityBegin { .. } => self.complete(
                id,
                failure(
                    "permission_denied",
                    "caller is not authorized for stream telemetry",
                ),
            ),
            Operation::StreamActivityEnd { session_id } if caller == STREAM_SESSION => {
                match self.collector.stream_activity_end(&session_id) {
                    Ok(()) => self.complete(id, json!({"ok":true,"active":false})),
                    Err(message) => self.complete(id, failure("invalid_request", message)),
                }
            }
            Operation::StreamActivityEnd { .. } => self.complete(
                id,
                failure(
                    "permission_denied",
                    "caller is not authorized for stream telemetry",
                ),
            ),
        }
    }

    fn drain_deferred_settings(&mut self) -> ModuleResult<()> {
        if !self.product_settings.is_ready() {
            return Ok(());
        }
        while let Some((request, operation)) = self.deferred_settings.pop_front() {
            self.handle_request(request, MANAGEMENT, operation, false)?;
        }
        Ok(())
    }

    fn complete(&mut self, request: u64, payload: Value) -> ModuleResult<()> {
        self.pending_completions.push_back((request, payload));
        Ok(())
    }
}

fn flush_completions(
    completions: &mut VecDeque<(u64, Value)>,
    send: &mut impl FnMut(Command) -> ModuleResult<Response>,
) {
    while let Some((request, payload)) = completions.front() {
        match send(Command::Complete {
            request: *request,
            payload: payload.clone(),
        }) {
            Ok(Response::Ok) => {}
            Ok(Response::Error { code, .. }) if code == "request_ended" || code == "not_found" => {}
            _ => break,
        }
        completions.pop_front();
    }
}

fn failure(code: &str, message: &str) -> Value {
    json!({"ok":false,"code":code,"message":message})
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    unsafe extern "C" fn unexpected_invoke(
        _context: *mut std::ffi::c_void,
        _input: amaterasu_module_sdk::abi::BorrowedBytes,
        _reply: amaterasu_module_sdk::abi::ReplySink,
    ) -> amaterasu_module_sdk::abi::Status {
        amaterasu_module_sdk::abi::STATUS_INTERNAL_ERROR
    }

    #[test]
    fn quiesce_waits_for_unsubmitted_settings_to_retire() {
        let endpoint = amaterasu_module_sdk::abi::HostApi {
            header: amaterasu_module_sdk::abi::AbiHeader::of::<amaterasu_module_sdk::abi::HostApi>(
            ),
            context: std::ptr::null_mut(),
            invoke: unexpected_invoke,
        };
        let mut module = HostMetricsModule {
            // SAFETY: the test callback is static and remains valid for the module lifetime.
            runtime: unsafe { RuntimeClient::from_endpoint(endpoint) },
            product_settings: ProductSettings::new("test"),
            collector: Collector::new(Settings::default()),
            deferred_settings: VecDeque::new(),
            pending_completions: VecDeque::new(),
            shutting_down: false,
        };
        assert!(!module.quiesce().unwrap());
        module.tick().unwrap();
        assert!(module.quiesce().unwrap());
    }

    #[test]
    fn lost_completion_reply_is_retried_before_retirement() {
        let payload = json!({"ok":true,"revision":3});
        let mut completions = VecDeque::from([(41, payload.clone())]);
        flush_completions(&mut completions, &mut |_| Err("reply lost".into()));
        assert_eq!(completions.front(), Some(&(41, payload.clone())));
        flush_completions(&mut completions, &mut |command| {
            assert!(
                matches!(command, Command::Complete { request: 41, payload: ref actual } if actual == &payload)
            );
            Ok(Response::error("request_ended", "already completed"))
        });
        assert!(completions.is_empty());
    }
}

amaterasu_module_sdk::export_module!(HostMetricsModule);

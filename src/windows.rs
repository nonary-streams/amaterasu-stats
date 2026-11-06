//! Windows host counters. OS allocations are released after each synchronous
//! snapshot; unsupported sensors remain absent rather than estimated.
use crate::{model::HostSnapshot, nvidia::NvidiaGpu};
use std::time::Instant;
use windows_sys::Win32::{
    Foundation::FILETIME,
    NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2},
    System::{
        SystemInformation::{GetSystemDirectoryW, GlobalMemoryStatusEx, MEMORYSTATUSEX},
        Threading::GetSystemTimes,
    },
};

pub struct Provider {
    cpu: Option<(u64, u64)>,
    network: Option<(u64, u64, Instant)>,
    nvidia: Option<NvidiaGpu>,
    gpu: Option<crate::windows_gpu::GpuCounters>,
    gpu_checked: bool,
}
impl Provider {
    pub fn new() -> Self {
        Self {
            cpu: None,
            network: None,
            nvidia: None,
            gpu: None,
            gpu_checked: false,
        }
    }
    pub fn reset_rate_baselines(&mut self) {
        self.cpu = None;
        self.network = None;
        self.gpu = None;
        self.nvidia = None;
        self.gpu_checked = false;
    }
    pub fn sample(&mut self, now: Instant) -> HostSnapshot {
        let mut result = HostSnapshot::unavailable();
        self.sample_cpu(&mut result);
        self.sample_network(now, &mut result);
        if let Some((used, total)) = physical_memory() {
            result.ram_used_bytes = Some(used);
            result.ram_total_bytes = Some(total);
        }
        if !self.gpu_checked {
            self.nvidia = NvidiaGpu::open();
            self.gpu = crate::windows_gpu::GpuCounters::open();
            self.gpu_checked = true;
        }
        if let Some(gpu) = &self.gpu {
            gpu.sample(&mut result);
        }
        if let Some(nvidia) = &self.nvidia {
            let mut measured = HostSnapshot::unavailable();
            nvidia.sample(&mut measured);
            result.gpu_percent = measured.gpu_percent.or(result.gpu_percent);
            result.gpu_encoder_percent =
                measured.gpu_encoder_percent.or(result.gpu_encoder_percent);
            result.gpu_temp_c = measured.gpu_temp_c;
            // A device's usage must not be paired with all-adapter capacity (or
            // vice versa) if one NVML query fails.
            if let (Some(used), Some(total)) = (measured.vram_used_bytes, measured.vram_total_bytes)
            {
                result.vram_used_bytes = Some(used);
                result.vram_total_bytes = Some(total);
            }
        }
        result
    }
    fn sample_cpu(&mut self, snapshot: &mut HostSnapshot) {
        let Some((total, idle)) = cpu_times() else {
            return;
        };
        if let Some((previous_total, previous_idle)) = self.cpu
            && total > previous_total
            && idle >= previous_idle
        {
            let elapsed = total - previous_total;
            let rest = idle - previous_idle;
            if rest <= elapsed {
                snapshot.cpu_percent = Some(100.0 * (elapsed - rest) as f64 / elapsed as f64);
            }
        }
        self.cpu = Some((total, idle));
    }
    fn sample_network(&mut self, now: Instant, snapshot: &mut HostSnapshot) {
        let Some((received, sent)) = network_counters() else {
            return;
        };
        if let Some((previous_rx, previous_tx, previous_time)) = self.network
            && received >= previous_rx
            && sent >= previous_tx
        {
            let seconds = now.saturating_duration_since(previous_time).as_secs_f64();
            if seconds > 0.0 {
                snapshot.net_rx_bps = Some((received - previous_rx) as f64 * 8.0 / seconds);
                snapshot.net_tx_bps = Some((sent - previous_tx) as f64 * 8.0 / seconds);
            }
        }
        self.network = Some((received, sent, now));
    }
}
fn cpu_times() -> Option<(u64, u64)> {
    // SAFETY: initialized writable FILETIME outputs; read only after success.
    unsafe {
        let (mut idle, mut kernel, mut user) = (
            std::mem::zeroed::<FILETIME>(),
            std::mem::zeroed::<FILETIME>(),
            std::mem::zeroed::<FILETIME>(),
        );
        let ticks =
            |time: FILETIME| (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
        if GetSystemTimes(&mut idle, &mut kernel, &mut user) == 0 {
            return None;
        }
        Some((ticks(kernel).saturating_add(ticks(user)), ticks(idle)))
    }
}
fn physical_memory() -> Option<(u64, u64)> {
    // SAFETY: the initialized C structure advertises its exact ABI size.
    unsafe {
        let mut memory: MEMORYSTATUSEX = std::mem::zeroed();
        memory.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut memory) == 0 || memory.ullAvailPhys > memory.ullTotalPhys {
            return None;
        }
        Some((
            memory.ullTotalPhys - memory.ullAvailPhys,
            memory.ullTotalPhys,
        ))
    }
}
fn network_counters() -> Option<(u64, u64)> {
    // SAFETY: GetIfTable2 owns the bounded contiguous row allocation. No pointer
    // escapes this call; FreeMibTable releases it before every successful return.
    unsafe {
        let mut table = std::ptr::null_mut();
        if GetIfTable2(&mut table) != 0 || table.is_null() {
            return None;
        }
        let count = (*table).NumEntries;
        let result = if count <= 4096 {
            let mut received = 0u64;
            let mut sent = 0u64;
            for index in 0..count as usize {
                let row = &*(*table).Table.as_ptr().add(index);
                if row.Type != 24 && row.OperStatus == 1 {
                    received = received.saturating_add(row.InOctets);
                    sent = sent.saturating_add(row.OutOctets);
                }
            }
            Some((received, sent))
        } else {
            None
        };
        FreeMibTable(table.cast());
        result
    }
}

/// Select the installed driver library, never an application working directory.
pub(crate) fn nvidia_driver_path() -> Option<std::path::PathBuf> {
    system_library_path("nvml.dll")
}

pub(crate) fn system_library_path(name: &str) -> Option<std::path::PathBuf> {
    let mut buffer = vec![0u16; 32768];
    // SAFETY: the bounded writable UTF-16 buffer lives throughout the OS call.
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return None;
    }
    Some(std::path::PathBuf::from(String::from_utf16(&buffer[..length]).ok()?).join(name))
}

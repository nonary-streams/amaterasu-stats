//! Bounded, demand-driven Windows GPU performance counters. Missing counters
//! remain unavailable; no polling thread or background subscription is created.
use crate::model::HostSnapshot;
use windows_sys::Win32::System::Performance::*;

pub(crate) struct GpuCounters {
    query: PDH_HQUERY,
    graphics: Option<PDH_HCOUNTER>,
    encoder: Option<PDH_HCOUNTER>,
    memory: Option<PDH_HCOUNTER>,
}
impl GpuCounters {
    pub fn open() -> Option<Self> {
        let mut query = std::ptr::null_mut();
        // SAFETY: PDH fills an initialized query handle, owned until Drop.
        if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
            return None;
        }
        let result = Self {
            query,
            graphics: add_counter(query, r"\GPU Engine(*engtype_3D)\Utilization Percentage"),
            encoder: add_counter(
                query,
                r"\GPU Engine(*engtype_VideoEncode)\Utilization Percentage",
            ),
            memory: add_counter(query, r"\GPU Adapter Memory(*)\Dedicated Usage"),
        };
        Some(result)
    }
    pub fn sample(&self, snapshot: &mut HostSnapshot) {
        // SAFETY: query remains live and this synchronous call is serialized.
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return;
        }
        snapshot.gpu_percent = self
            .graphics
            .and_then(read_sum)
            .map(|value| value.min(100.0));
        snapshot.gpu_encoder_percent = self
            .encoder
            .and_then(read_sum)
            .map(|value| value.min(100.0));
        snapshot.vram_used_bytes = self
            .memory
            .and_then(read_sum)
            .filter(|value| *value < u64::MAX as f64)
            .map(|value| value as u64);
    }
}
impl Drop for GpuCounters {
    fn drop(&mut self) {
        // SAFETY: close the successful query exactly once, retiring its counters.
        unsafe {
            PdhCloseQuery(self.query);
        }
    }
}
fn add_counter(query: PDH_HQUERY, path: &str) -> Option<PDH_HCOUNTER> {
    let path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut counter = std::ptr::null_mut();
    // SAFETY: the NUL-terminated path and output outlive the synchronous call.
    (unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) } == 0)
        .then_some(counter)
}
fn read_sum(counter: PDH_HCOUNTER) -> Option<f64> {
    let (mut bytes, mut count) = (0, 0);
    // SAFETY: the first query requests only the required buffer size.
    if unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut bytes,
            &mut count,
            std::ptr::null_mut(),
        )
    } != PDH_MORE_DATA
        || bytes == 0
        || bytes > 1024 * 1024
    {
        return None;
    }
    let mut buffer = vec![0u64; (bytes as usize).div_ceil(8)];
    let capacity = buffer.len() * 8;
    // SAFETY: u64 storage provides the ABI alignment and bounded requested size.
    // Returned names are never dereferenced; only the validated item array is read.
    if unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut bytes,
            &mut count,
            buffer.as_mut_ptr().cast(),
        )
    } != 0
        || bytes as usize > capacity
        || count > 4096
        || (count as usize).checked_mul(std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>())?
            > capacity
    {
        return None;
    }
    let rows = unsafe {
        std::slice::from_raw_parts(
            buffer.as_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>(),
            count as usize,
        )
    };
    let mut total = 0.0;
    let mut measured = false;
    for row in rows {
        if row.FmtValue.CStatus > 1 {
            continue;
        }
        // SAFETY: PDH_FMT_DOUBLE selects this union member after a valid status.
        let value = unsafe { row.FmtValue.Anonymous.doubleValue };
        if value.is_finite() && value >= 0.0 {
            total += value;
            measured = true;
        }
    }
    (measured && total.is_finite()).then_some(total)
}

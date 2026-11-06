//! NVIDIA's read-only NVML ABI. The library owns every device handle; all calls
//! finish synchronously before the retained library is unloaded.
use crate::model::HostSnapshot;
use libloading::Library;
use std::ffi::c_void;

#[repr(C)]
#[derive(Default)]
struct Utilization {
    gpu: u32,
    memory: u32,
}
#[repr(C)]
#[derive(Default)]
struct Memory {
    total: u64,
    free: u64,
    used: u64,
}
type Device = *mut c_void;
type Shutdown = unsafe extern "C" fn() -> u32;
type UtilizationRead = unsafe extern "C" fn(Device, *mut Utilization) -> u32;
type MemoryRead = unsafe extern "C" fn(Device, *mut Memory) -> u32;
type TemperatureRead = unsafe extern "C" fn(Device, u32, *mut u32) -> u32;
type EncoderRead = unsafe extern "C" fn(Device, *mut u32, *mut u32) -> u32;

pub(crate) struct NvidiaGpu {
    device: Device,
    shutdown: Shutdown,
    utilization: UtilizationRead,
    memory: MemoryRead,
    temperature: TemperatureRead,
    encoder: EncoderRead,
    _library: Library,
}
impl NvidiaGpu {
    pub fn open() -> Option<Self> {
        #[cfg(target_os = "windows")]
        let path = crate::windows::nvidia_driver_path()?;
        #[cfg(not(target_os = "windows"))]
        let path = "libnvidia-ml.so.1";
        // SAFETY: trusted installed GPU-driver ABI, fixed symbol names/signatures
        // from nvml.h. No network/client value chooses code or device pointers.
        unsafe {
            let library = Library::new(path).ok()?;
            let initialize: unsafe extern "C" fn() -> u32 = *library.get(b"nvmlInit_v2\0").ok()?;
            let shutdown: Shutdown = *library.get(b"nvmlShutdown\0").ok()?;
            let device_by_index: unsafe extern "C" fn(u32, *mut Device) -> u32 =
                *library.get(b"nvmlDeviceGetHandleByIndex_v2\0").ok()?;
            let utilization = *library
                .get::<UtilizationRead>(b"nvmlDeviceGetUtilizationRates\0")
                .ok()?;
            let memory = *library
                .get::<MemoryRead>(b"nvmlDeviceGetMemoryInfo\0")
                .ok()?;
            let temperature = *library
                .get::<TemperatureRead>(b"nvmlDeviceGetTemperature\0")
                .ok()?;
            let encoder = *library
                .get::<EncoderRead>(b"nvmlDeviceGetEncoderUtilization\0")
                .ok()?;
            if initialize() != 0 {
                return None;
            }
            let mut device = std::ptr::null_mut();
            if device_by_index(0, &mut device) != 0 || device.is_null() {
                shutdown();
                return None;
            }
            Some(Self {
                device,
                shutdown,
                utilization,
                memory,
                temperature,
                encoder,
                _library: library,
            })
        }
    }
    pub fn sample(&self, snapshot: &mut HostSnapshot) {
        // SAFETY: the live library retains the device handle, and each writable
        // output is initialized with the exact C ABI layout before a sync call.
        unsafe {
            let mut utilization = Utilization::default();
            if (self.utilization)(self.device, &mut utilization) == 0 {
                snapshot.gpu_percent = percent(utilization.gpu);
            }
            let mut memory = Memory::default();
            if (self.memory)(self.device, &mut memory) == 0 && memory.used <= memory.total {
                snapshot.vram_used_bytes = Some(memory.used);
                snapshot.vram_total_bytes = Some(memory.total);
            }
            let mut temperature = 0;
            if (self.temperature)(self.device, 0, &mut temperature) == 0 && temperature <= 150 {
                snapshot.gpu_temp_c = Some(temperature as f64);
            }
            let (mut encoder, mut period) = (0, 0);
            if (self.encoder)(self.device, &mut encoder, &mut period) == 0 {
                snapshot.gpu_encoder_percent = percent(encoder);
            }
        }
    }
}
fn percent(value: u32) -> Option<f64> {
    (value <= 100).then_some(value as f64)
}
impl Drop for NvidiaGpu {
    fn drop(&mut self) {
        // SAFETY: release exactly the successful initialization owned by this
        // provider before dropping the retained driver library.
        unsafe {
            (self.shutdown)();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_driver_values_do_not_become_zero() {
        assert_eq!(percent(u32::MAX), None);
        assert_eq!(percent(101), None);
        assert_eq!(percent(0), Some(0.0));
    }
    #[test]
    #[ignore = "requires an installed NVIDIA driver and NVML device"]
    fn installed_nvml_reports_real_device_memory() {
        let gpu = NvidiaGpu::open().expect("NVML device");
        let mut sample = HostSnapshot::unavailable();
        gpu.sample(&mut sample);
        assert!(sample.vram_total_bytes.is_some_and(|value| value > 0));
        assert!(sample.vram_used_bytes.unwrap() <= sample.vram_total_bytes.unwrap());
        assert!(sample.gpu_percent.is_some());
    }
}

//! Read-only dedicated-memory capacity from DXGI 1.1. Small COM declarations
//! mirror dxgi.h / Microsoft's windows-rs bindings. Unused inherited slots are
//! opaque pointer-sized ABI fields and are never called or dereferenced.
use libloading::Library;
use std::{collections::BTreeSet, ffi::c_void, ptr::NonNull};
use windows_sys::core::{GUID, IUnknown_Vtbl};

const MAX_ADAPTERS: u32 = 32;
const DXGI_ERROR_NOT_FOUND: i32 = 0x887a0002u32 as i32;
const SOFTWARE_ADAPTER: u32 = 2;

#[repr(C)]
struct FactoryVtable {
    unknown: IUnknown_Vtbl,
    object: [usize; 4],
    factory: [usize; 5],
    enum_adapters1: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
}
#[repr(C)]
struct AdapterVtable {
    unknown: IUnknown_Vtbl,
    object: [usize; 4],
    adapter: [usize; 3],
    get_desc1: unsafe extern "system" fn(*mut c_void, *mut AdapterDescription) -> i32,
}
#[repr(C)]
struct AdapterDescription {
    description: [u16; 128],
    vendor: u32,
    device: u32,
    subsystem: u32,
    revision: u32,
    dedicated_video_memory: usize,
    dedicated_system_memory: usize,
    shared_system_memory: usize,
    luid_low: u32,
    luid_high: i32,
    flags: u32,
}

struct ComObject(NonNull<c_void>);
impl Drop for ComObject {
    fn drop(&mut self) {
        // SAFETY: this owns exactly one successful COM output reference. The
        // system DXGI library is retained until every object is released.
        unsafe {
            let table = *self.0.as_ptr().cast::<*const IUnknown_Vtbl>();
            ((*table).Release)(self.0.as_ptr());
        }
    }
}

#[derive(Default)]
struct AdapterCapacities {
    seen: BTreeSet<(u32, i32)>,
    total: u64,
}
impl AdapterCapacities {
    fn record(&mut self, luid: (u32, i32), flags: u32, dedicated: u64) -> Option<()> {
        if flags & SOFTWARE_ADAPTER == 0 && self.seen.insert(luid) {
            self.total = self.total.checked_add(dedicated)?;
        }
        Some(())
    }
    fn finish(self) -> Option<u64> {
        (self.total > 0).then_some(self.total)
    }
}

/// Hardware adapter capacity, aggregated to match the PDH adapter-memory sum.
/// Zero on shared-memory GPUs is not treated as a dedicated VRAM capacity.
pub(crate) fn dedicated_capacity() -> Option<u64> {
    let path = super::windows::system_library_path("dxgi.dll")?;
    // SAFETY: fixed library name beneath the OS system directory; the handle
    // outlives factory and adapter references and all synchronous calls below.
    let library = unsafe { Library::new(path) }.ok()?;
    type CreateFactory = unsafe extern "system" fn(*const GUID, *mut *mut c_void) -> i32;
    let create = unsafe { library.get::<CreateFactory>(b"CreateDXGIFactory1\0") }.ok()?;
    let mut factory = std::ptr::null_mut();
    let iid = GUID::from_u128(0x770aae78_f26f_4dba_a829_253c83d1b387);
    // SAFETY: the exact IDXGIFactory1 IID establishes the vtable contract.
    if unsafe { create(&iid, &mut factory) } < 0 {
        return None;
    }
    let factory = ComObject(NonNull::new(factory)?);
    // SAFETY: a successful factory reference exposes the documented vtable.
    let table = unsafe { &**factory.0.as_ptr().cast::<*const FactoryVtable>() };
    let mut capacities = AdapterCapacities::default();
    for index in 0..MAX_ADAPTERS {
        let mut adapter = std::ptr::null_mut();
        let status = unsafe { (table.enum_adapters1)(factory.0.as_ptr(), index, &mut adapter) };
        if status == DXGI_ERROR_NOT_FOUND {
            return capacities.finish();
        }
        if status < 0 {
            return None;
        }
        let adapter = ComObject(NonNull::new(adapter)?);
        let table = unsafe { &**adapter.0.as_ptr().cast::<*const AdapterVtable>() };
        // SAFETY: all-zero bytes are valid for this C output descriptor, and
        // GetDesc1 initializes the output before we inspect a successful result.
        let mut description: AdapterDescription = unsafe { std::mem::zeroed() };
        if unsafe { (table.get_desc1)(adapter.0.as_ptr(), &mut description) } < 0 {
            return None;
        }
        capacities.record(
            (description.luid_low, description.luid_high),
            description.flags,
            description.dedicated_video_memory as u64,
        )?;
    }
    // A truncated topology must never become a plausible partial capacity.
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capacity_counts_unique_hardware_and_preserves_unknown_and_overflow() {
        let mut capacities = AdapterCapacities::default();
        assert_eq!(AdapterCapacities::default().finish(), None);
        capacities.record((1, 0), SOFTWARE_ADAPTER, 999).unwrap();
        capacities.record((2, 0), 0, 8000).unwrap();
        capacities.record((2, 0), 0, 8000).unwrap();
        capacities.record((3, 0), 0, 4000).unwrap();
        capacities.record((4, 0), 0, 0).unwrap();
        assert_eq!(capacities.finish(), Some(12000));
        let mut capacities = AdapterCapacities::default();
        capacities.record((1, 0), 0, u64::MAX).unwrap();
        assert_eq!(capacities.record((2, 0), 0, 1), None);
    }
    #[test]
    fn dxgi_prefixes_match_the_documented_com_slot_offsets() {
        use std::mem::{offset_of, size_of};
        assert_eq!(
            offset_of!(FactoryVtable, enum_adapters1),
            12 * size_of::<usize>()
        );
        assert_eq!(
            offset_of!(AdapterVtable, get_desc1),
            10 * size_of::<usize>()
        );
        assert_eq!(offset_of!(AdapterDescription, dedicated_video_memory), 272);
        assert_eq!(
            offset_of!(AdapterDescription, luid_low),
            272 + 3 * size_of::<usize>()
        );
    }
}

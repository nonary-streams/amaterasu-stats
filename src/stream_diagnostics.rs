//! Bounded procfs observations run only on the existing sampler worker.
use crate::model::HostSnapshot;
#[cfg(any(target_os = "linux", test))]
use serde_json::Value;
use serde_json::json;
#[cfg(any(target_os = "linux", test))]
use std::{collections::BTreeSet, fs, io::Read, path::Path};

#[cfg(any(target_os = "linux", test))]
fn read(path: impl AsRef<Path>) -> Option<String> {
    let mut text = String::new();
    fs::File::open(path)
        .ok()?
        .take(256 * 1024)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

pub(crate) fn collect(snapshot: &HostSnapshot, dropped: u64) -> Vec<String> {
    let clock = amaterasu_module_sdk::diagnostics::monotonic_time_us();
    let mut records = vec![json!({"event":"host_sample_window","pid":std::process::id(),
        "monotonic_us":clock,"host":snapshot,"diagnostic_batches_dropped_cumulative":dropped,
        "scope":"sampled_cpu_memory_gpu_temperature_and_network_counters_not_per_frame_device_timing"}).to_string()];
    #[cfg(target_os = "linux")]
    linux(&mut records, clock);
    records
}

#[cfg(target_os = "linux")]
fn linux(records: &mut Vec<String>, clock: Option<u64>) {
    let mut tasks: Vec<_> = fs::read_dir("/proc/self/task")
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    tasks.sort_by_key(|entry| entry.file_name());
    let thread_count = tasks.len();
    let threads: Vec<Value> = tasks.into_iter().take(128).filter_map(|task| {
        let path = task.path();
        let schedstat = read(path.join("schedstat"))?;
        let values: Vec<u64> = schedstat.split_whitespace().filter_map(|v|v.parse().ok()).collect();
        if values.len()!=3 { return None; }
        let status = read(path.join("status"));
        let count = |key:&str| status.as_ref().and_then(|text|text.lines().find_map(|line|
            line.strip_prefix(key).and_then(|v|v.trim().parse::<u64>().ok())));
        Some(json!({"tid":task.file_name().to_string_lossy(),"name":read(path.join("comm")).map(|s|s.trim().to_owned()),
            "run_ns_cumulative":values[0],"runnable_wait_ns_cumulative":values[1],"timeslices_cumulative":values[2],
            "voluntary_context_switches_cumulative":count("voluntary_ctxt_switches:"),
            "involuntary_context_switches_cumulative":count("nonvoluntary_ctxt_switches:"),
            "kernel_wait_site":read(path.join("wchan"))}))
    }).collect();
    for chunk in threads.chunks(12) {
        records.push(json!({"event":"host_thread_window","pid":std::process::id(),"monotonic_us":clock,
            "threads":chunk,"total_threads":thread_count,"thread_limit":128,
            "scope":"linux_thread_scheduler_run_and_runnable_wait_counters_not_blocked_io_duration"}).to_string());
    }
    let owned: BTreeSet<_> = fs::read_dir("/proc/self/fd")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| fs::read_link(entry.path()).ok())
        .filter_map(|p| {
            p.to_str()
                .and_then(|s| s.strip_prefix("socket:["))
                .and_then(|s| s.strip_suffix(']'))
                .map(str::to_owned)
        })
        .collect();
    let mut sockets = Vec::new();
    for name in ["udp", "udp6"] {
        if let Some(text) = read(format!("/proc/self/net/{name}")) {
            for line in text.lines().skip(1) {
                if let Some(socket) = parse_socket(line, &owned) {
                    sockets.push(socket);
                }
                if sockets.len() >= 128 {
                    break;
                }
            }
        }
    }
    for chunk in sockets.chunks(16) {
        records.push(
            json!({"event":"host_socket_window","monotonic_us":clock,"sockets":chunk,
            "socket_limit":128,"scope":"linux_owned_udp_kernel_queues_and_drop_counters"})
            .to_string(),
        );
    }
    records.push(
        json!({"event":"host_pressure_window","monotonic_us":clock,
        "cpu_pressure":read("/proc/pressure/cpu"),"io_pressure":read("/proc/pressure/io"),
        "memory_pressure":read("/proc/pressure/memory"),"process_io":read("/proc/self/io"),
        "process_faults_stat":read("/proc/self/stat").and_then(|s|parse_faults(&s)),
        "scope":"linux_pressure_stall_and_process_io_fault_counters"})
        .to_string(),
    );
}

#[cfg(any(target_os = "linux", test))]
fn parse_faults(stat: &str) -> Option<Value> {
    let tail = stat.rsplit_once(") ")?.1;
    let fields: Vec<_> = tail.split_whitespace().collect();
    Some(
        json!({"minor_faults_cumulative":fields.get(7)?.parse::<u64>().ok()?,
        "major_faults_cumulative":fields.get(9)?.parse::<u64>().ok()?}),
    )
}
#[cfg(any(target_os = "linux", test))]
fn parse_socket(line: &str, owned: &BTreeSet<String>) -> Option<Value> {
    let fields: Vec<_> = line.split_whitespace().collect();
    if fields.len() < 13 || !owned.contains(*fields.get(9)?) {
        return None;
    }
    let (send, receive) = fields[4].split_once(':')?;
    let (_, port) = fields[1].rsplit_once(':')?;
    Some(json!({"local_port":u16::from_str_radix(port,16).ok()?,
        "send_queue_bytes":u64::from_str_radix(send,16).ok()?,
        "receive_queue_bytes":u64::from_str_radix(receive,16).ok()?,
        "receive_drops_cumulative":fields.last()?.parse::<u64>().ok()?}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_os_records_stay_inside_the_host_logger_message_budget() {
        let records = collect(&HostSnapshot::unavailable(), 0);
        assert!(records.len() <= 32);
        assert!(records.iter().all(|line| line.len() <= 7500));
    }
    #[test]
    fn only_owned_sockets_are_reported_without_remote_addresses() {
        let line = "0: 0100007F:BBBC 0100007F:1234 01 00000004:00000008 00:00000000 00000000 1000 0 900 2 00000000 17";
        assert!(parse_socket(line, &BTreeSet::new()).is_none());
        let value = parse_socket(line, &["900".to_owned()].into()).unwrap();
        assert_eq!(value["receive_queue_bytes"], 8);
        assert_eq!(value["receive_drops_cumulative"], 17);
        assert!(!value.to_string().contains("0100007F"));
    }
    #[test]
    fn faults_are_parsed_after_the_final_process_name_parenthesis() {
        let value = parse_faults("42 (a (name)) R 1 2 3 4 5 6 7 8 9 10").unwrap();
        assert_eq!(value["minor_faults_cumulative"], 7);
        assert_eq!(value["major_faults_cumulative"], 9);
    }
}

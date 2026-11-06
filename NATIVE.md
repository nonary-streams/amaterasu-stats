# Host metrics module

`amaterasu.host-metrics/1` owns the real-time statistics preferences, measured
host snapshots, and a bounded in-memory chart history. Settings live in the
module's revisioned `amaterasu.configuration/1` product document. The service
does not synthesize samples: it records only values read from its platform
provider while collection is enabled and a dashboard or active stream holds a
consumer lease.

Management operations are `settings_get {}`, `settings_update {settings,
expected_revision}`, and `stats_read {}`. Settings updates use configuration
compare-and-swap revisions. Internal `stream_activity_begin {session_id}` and
`stream_activity_end {session_id}` operations are restricted to
`amaterasu.stream-session` and keep sampling active for actual streams even
when no dashboard is open.

Defaults are enabled, 2,000 ms polling, 300 seconds of live chart retention,
300 points, pause after a hidden dashboard lease expires, and all four display
sections enabled. Poll intervals are 250 to 60,000 ms, retention is 30 to
3,600 seconds, and the point limit is 30 to 2,000. The live history is
intentionally in memory; persisted stream history is owned by
`amaterasu.session-history/1`.

The management response includes at most 32 evenly spaced samples from the
retained window. This keeps the response within the management API body limit
while allowing retention and maximum-sample settings to control the time span
shown by the charts.

Linux sampling reads `/proc/stat` for CPU utilization, `/proc/meminfo` for
memory use, and aggregates non-loopback counters from `/proc/net/dev` for
network rates. CPU temperature is read only from recognized CPU thermal or
hwmon sensors. GPU utilization, VRAM, and temperature use DRM device sysfs
attributes when the driver exposes them (currently the AMD DRM interfaces on
common Linux drivers). NVIDIA devices use the installed read-only NVML ABI for GPU utilization,
encoder utilization, VRAM, and temperature. Missing or unsupported device queries
remain null. Device zero is the host adapter observation; this does not assert
that it is the GPU selected for a particular stream.

Windows uses GetSystemTimes, GlobalMemoryStatusEx and GetIfTable2 for CPU,
physical memory, and non-loopback network rates, plus bounded PDH GPU counters and NVML for NVIDIA metrics.
macOS remains unsupported. Every unavailable metric is independently null;
a missing sensor never becomes a zero reading. CPU and network rates require
two real source readings before a delta can be reported.

# Statistics parity and qualification

Vibeshine's modern Stats view was used as a behavioral reference. Its source was
not copied or translated. The existing Amaterasu statistics implementation was
moved intact before adding the public plugin boundaries and chart controls.

| Behavior | Implementation |
| --- | --- |
| CPU, GPU, RAM, VRAM gauges and temperatures | Shared gauges SDK; unavailable sensors remain null |
| Encoder utilization and network rates | Read-only NVML and measured OS byte deltas |
| Host charts, visible ranges, inspection | Shared chart SDK, stable zoom during polling, keyboard and pointer inspection, series toggles |
| Active streams and per-stream charts | Independent live counters, recording-independent observations, source/range selection |
| Stop a selected active stream | Approved streaming API; retains transport ownership and confirms normal cleanup |
| Recorded session cards and detail | Paged records, bounded full timelines, events and performance charts |
| Reconnect-like grouping | Matching adjacent records with explicit uncertainty; member identities retained |
| JSON and CSV exports | Complete selected returned data; CSV formula neutralization |
| Retention and recording settings | Versioned writes/readback; deferred recording changes preserve active streams |
| Disabled and hidden states | Display preferences, demand-driven collection, hidden-page pause, disposal |
| Responsive and accessible controls | Responsive cards, named gauges, keyboard charts, dialogs, read-only permissions |
| Independent replacement | Signed UI alias approvals and versioned native APIs; no private host UI imports |

Linux CPU, memory and network collection retains existing real-source tests.
NVIDIA GPU, VRAM, encoder and temperature values now use installed NVML when
available; AMD DRM sysfs remains supported. Windows CPU, memory and network use
Win32 counters; NVIDIA measurements use the same NVML adapter. Windows bindings
are source-checked from Linux; an actual Windows host run is a separate gate.
Windows GPU performance counters additionally supply non-NVIDIA GPU load, encoder
load and dedicated memory usage when the driver exposes those counters. A
non-NVIDIA memory capacity or unsupported CPU temperature sensor remains
unavailable instead of being estimated. macOS remains unsupported.

The native APIs preserve output field bounds, counter provenance, cancellation,
recording admission, and result release. The dashboard is not proof of gameplay
performance. Live client playback and installed-host qualification remain
separate from isolated source, browser, driver, and API replacement tests.

## Outstanding measurement parity

The current video/encoder contract does not report measured encoder latency;
`encode_latency_ms` remains null when no provider supplies a measurement. The UI
can chart reported values, but this extraction does not turn queue acceptance
into encode, capture, display, or client latency. Per-stage timing instrumentation
requires a separately qualified media-provider contract. Windows non-NVIDIA
VRAM capacity is also unavailable without an adapter capacity source. These are
remaining data-parity requirements, not completed measurements.

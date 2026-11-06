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
| Encoder pipeline latency | Provider input-to-owned-output-ready timings through the public SDK; live interval means, recorded samples, unknown gaps and replacement epochs |
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
load and dedicated memory usage when the driver exposes those counters. DXGI supplies aggregate hardware dedicated-memory capacity to pair with the PDH
adapter usage sum; software and duplicate adapters are excluded. A shared-memory
GPU without dedicated capacity, or an unsupported CPU temperature sensor, remains
unavailable instead of being estimated. macOS remains unsupported.

The native APIs preserve output field bounds, counter provenance, cancellation,
recording admission, and result release. The dashboard is not proof of gameplay
performance. Live client playback and installed-host qualification remain
separate from isolated source, browser, driver, and API replacement tests.

## Measurement scope and remaining qualification

The optional encoder v1.3, encoder-provider v1.1 and video v1.4 timing tails
carry exact cumulative completed-frame measurements. The reference encoder
records input submission and timestamps owned coded output when the backend
produces it, before it waits in consumer queues. This includes provider
conversion, worker queueing and encoding through the provider's output-readiness
observation; an asynchronous codec's internal completion time is not separately
known. It excludes later consumer polling, rejected-sink retries, capture,
transport, decode and presentation. It is not a GPU execution-only measurement.

Live and recorded samples use means of compatible cumulative interval deltas.
A provider without the optional interface, a missing measurement, an interval
with no newly measured frames, a backwards counter or a replacement epoch
remains unknown. A genuine measured zero remains zero. No admission is treated
as completion and no client latency is invented.

Linux NVIDIA and software x264 qualification can run locally with isolated
synthetic frames through the same public SDK query. Windows CPU/network/PDH,
DXGI capacity and NVML bindings are source-checked from Linux, with adapter
filtering and ABI layout regressions. Actual Windows driver/hardware testing
and installed-host/client qualification remain deferred. Device-only stage
breakdowns and client presentation latency require their own measured sources;
they are not inferred from these encoder pipeline timings.

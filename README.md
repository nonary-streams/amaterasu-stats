# Amaterasu Stats

An independently built core plugin for Amaterasu: demand-driven host metrics,
recorded-session storage, and a separately signed dashboard UI. Product behavior
lives here; the shell hosts signed extension surfaces and the shared UI SDK.

The repository retains the installed `amaterasu.host-metrics` and
`amaterasu.session-history` module identities and state documents. This preserves
stream recording, settings revisions, existing SQLite data, and upgrade policy.
It builds two native libraries, not an alternative host executable. Neither
consumer falls back to a built-in collector when this plugin is absent.

## Build

A current Amaterasu SDK checkout is required, including the operation API adapter,
charts SDK, and overview/settings extension surfaces introduced with this plugin.
When checked out as `modules/stats`, the parent Cargo workspace builds both
libraries normally. A separate checkout builds without modifying the SDK:

```sh
export CARGO_TARGET_DIR=/path/on/build-volume/amaterasu-stats-target
python3 scripts/build-native.py /path/to/amaterasu --test
python3 scripts/build-native.py /path/to/amaterasu --clippy
python3 scripts/build-native.py /path/to/amaterasu --release
cd ui
npm ci
npm test
npm run build
```

The SDK calls and versioned provider APIs are the same for built-in and external
consumers. Native plugins are trusted code; API grants are not a native sandbox.

## Public APIs and UI

`metadata/api.json` describes the collector's public `nonary.stats/1` methods.
`history/metadata/api.json` describes `nonary.stats-history/1`. Their legacy
internal recording services remain compatible. UI access uses declared,
locally approved aliases through `sdk.call`; it never imports the shell's
namespace, invokes its private renderers, or issues arbitrary management routes.
Live stream snapshots and selected-stream stop operations use the separately
selected streaming provider's versioned API. See `ui/ui.json` for the complete
method declarations and account scopes. Native SDK consumers can use the same
public methods when explicitly selected as callers in startup API approvals;
they are not required to impersonate the management module.

The UI attaches a Statistics page, overview gauges, and settings forms through
signed placements. It uses shared SDK gauges and charts with zoom, legends,
keyboard/pointer inspection, missing-value gaps, and responsive layouts. Its
styles are fetched from the same verified, selected bundle as its script.
Forms preserve unsaved drafts and block navigation while writes are pending.
Live polling pauses when hidden and is retired when its surface closes.

## Package and select

Build `amaterasu-web-extension` from the SDK, then prepare a signed UI bundle:

```sh
scripts/package-ui.sh /path/to/amaterasu-web-extension OUTPUT SEQUENCE EXPIRES_UNIX SECRET_HEX_FILE
```

Use the existing approved publisher. Stage with the standard web-extension
utility into a dedicated extension root, and add a management `extensions.entries`
entry with id `stats`, that root, the pinned publisher key, and the approved
`methods` from `ui/ui.json`. Native package composition must select both native
libraries and the exact method approvals in the two metadata files. Signed UI
declarations alone never grant API access. The normal signed package import and
activation path still applies to native updates; building or publishing this
repository does not install or activate it.

## Measurements and parity

See [PARITY.md](PARITY.md), [native collection](NATIVE.md), and
[history storage](history/README.md). Rates describe host observations and
transport acceptance; they do not prove client presentation latency or delivery.

#!/usr/bin/env bash
# Prepare a separately signed bundle; selecting it remains administrator policy.
set -euo pipefail
if (( $# != 5 )); then
  echo 'usage: package-ui.sh WEB_EXTENSION_TOOL OUTPUT SEQUENCE EXPIRES_UNIX SECRET_HEX_FILE' >&2
  exit 2
fi
repository=$(cd -- "$(dirname -- "$0")/.." && pwd)
"$1" pack "$repository/ui/dist" "$2" stats Statistics stats.js "$3" "$4" "$5" "$repository/ui/ui.json"

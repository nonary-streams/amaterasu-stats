#!/usr/bin/env python3
"""Build this independent repository against an explicit Amaterasu SDK checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("sdk_root", type=Path)
parser.add_argument("--test", action="store_true")
parser.add_argument("--clippy", action="store_true")
parser.add_argument("--release", action="store_true")
args = parser.parse_args()
repository = Path(__file__).resolve().parents[1]
sdk_root = args.sdk_root.resolve(strict=True)
for path in [sdk_root / "crates/module-sdk", sdk_root / "crates/storage"]:
    if not (path / "Cargo.toml").is_file():
        parser.error(f"SDK source missing: {path}")
if not os.environ.get("CARGO_TARGET_DIR"):
    parser.error("Set CARGO_TARGET_DIR to the intended build volume")
target = Path(os.environ["CARGO_TARGET_DIR"]).resolve()
target.mkdir(parents=True, exist_ok=True)
# Generate only build manifests. Do not rewrite the plugin or SDK checkout.
with tempfile.TemporaryDirectory(prefix="amaterasu-stats-manifest-", dir=target) as temporary:
    workspace = Path(temporary)
    (workspace / "Cargo.toml").write_text('[workspace]\nresolver="2"\nmembers=["collector","history"]\n')
    for name, source in [("collector", repository), ("history", repository / "history")]:
        destination = workspace / name
        destination.mkdir()
        manifest = (source / "Cargo.toml").read_text()
        manifest = manifest.replace('[lib]', '[lib]\npath = ' + json.dumps(str(source / "src/lib.rs")))
        for dependency in ["module-sdk", "storage"]:
            manifest = re.sub(r'path = "[^"\n]*crates/' + dependency + r'"',
                              'path = ' + json.dumps(str(sdk_root / "crates" / dependency)), manifest)
        (destination / "Cargo.toml").write_text(manifest)
    operation = "test" if args.test else "clippy" if args.clippy else "build"
    command = ["cargo", operation, "--manifest-path", str(workspace / "Cargo.toml"), "--workspace"]
    if args.release:
        command += ["--release"]
    if args.clippy:
        command += ["--all-targets", "--", "-D", "warnings"]
    subprocess.run(command, check=True)

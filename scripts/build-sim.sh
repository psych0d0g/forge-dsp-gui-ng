#!/usr/bin/env bash
# Simulator of the Forge (forge-dsp-firmware tools/sim) for the GUI: the firmware as WebAssembly.
#   scripts/build-sim.sh OUT_DIR [FLAVOURS] [FIRMWARE_REF]
# Writes OUT_DIR/forge-sim-<flavour>.mjs and OUT_DIR/index.json. Needs git, make and a network;
# installs emsdk (pinned) into $EMSDK_DIR (default ~/.cache/emsdk) unless emcc is already there.
set -euo pipefail
OUT=$(realpath -m "$1"); FLAVOURS=${2:-}; REF=${3:-main}
EMSDK_VERSION=6.0.13
REPO=https://github.com/psych0d0g/forge-dsp-firmware.git
EMSDK_DIR=${EMSDK_DIR:-$HOME/.cache/emsdk}

if ! command -v emcc >/dev/null; then
  [ -d "$EMSDK_DIR" ] || git clone -q https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  (cd "$EMSDK_DIR" && git fetch -q --tags && git checkout -q "$EMSDK_VERSION" && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
fi

SRC=$(mktemp -d)
trap 'rm -rf "$SRC"' EXIT
git clone -q --depth 1 --branch "$REF" "$REPO" "$SRC/fw" 2>/dev/null || { git clone -q "$REPO" "$SRC/fw" && git -C "$SRC/fw" checkout -q "$REF"; }
mkdir -p "$OUT"
make -s -C "$SRC/fw/tools/sim" O="$OUT" ${FLAVOURS:+FLAVOURS="$FLAVOURS"} -j"$(nproc)"
( cd "$OUT" && ls forge-sim-*.mjs | sed 's/^forge-sim-//; s/\.mjs$//' | python3 -c '
import json, sys; print(json.dumps({"format": 1, "flavours": [l.strip() for l in sys.stdin if l.strip()]}))' > index.json )
cat "$OUT/index.json"; ls -la "$OUT"

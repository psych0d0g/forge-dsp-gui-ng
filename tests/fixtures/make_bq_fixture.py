#!/usr/bin/env python3
"""Coefficients of the firmware for the biquad tests:
  make_bq_fixture.py <forge-dsp-firmware>/tests/native/build/cmd-V40-96ELN > biquad.json
Each case [type, f, gain (0.1 dB), q (1/1000), b] with the firmware's 5.23 words A2 A1 B2 B1 B0
(a1/a2 negated, as the DSP adds them)."""
import json
import subprocess
import sys

CASES = []
for t in range(1, 23):
    for f, g, q, b in ((80, 30, 707, 45), (1000, -60, 1414, 300), (6300, 60, 500, 270), (18000, 0, 2000, 120)):
        CASES.append([t, f, g, q, b])
p = subprocess.run([sys.argv[1]], input="\n".join("#bq_calc=%d,%d,%d,%d,%d,128" % tuple(c) for c in CASES) + "\n",
                   capture_output=True, text=True, timeout=60, check=True)
raw = [l[4:].split() for l in p.stdout.splitlines() if l.startswith("@bq:")]
assert len(raw) == len(CASES)
json.dump({"rate": 96000, "cases": [{"in": c, "raw": r} for c, r in zip(CASES, raw)]}, sys.stdout)

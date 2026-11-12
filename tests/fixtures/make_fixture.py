#!/usr/bin/env python3
"""Records the answers of the firmware's command interpreter for the device model tests.

  make_fixture.py <forge-dsp-firmware>/tests/native/build/cmd-V40-96ELN V40-96ELN > V40-96ELN.json

The native build of forge-dsp-firmware (make -C tests/native) runs the same protocol code as
the device. A few values are set first so the fixture is not all zeros.
"""
import json
import subprocess
import sys

PRE = ["#pin=PIN_CPU_POWER_CTRL_IN,1", "#store_init", "#i2cdsp=1,68", "#i2cdsp=2,68", "#i2cdsp=2,6A", "#dsp_detect",
       "#events_init", "#dtr=1", "#modc_init", "1|set.1 preset.loaded=0", "#mainloop"]
SETS = ["set.1 mixer.position=1", "set.1 gain.out.1=223", "set.1 gain.out.2=199", "set.1 gain.in.1=200",
        "set.1 mute.out.3=1", "set.1 phase.out.4=1", "set.1 delay.2=48", "set.1 mixer.1.3.2=100",
        "set.1 mixer.1.4.1=80", "set.1 biquad.1.1.calc=[1,1000,35,1414,0,128]",
        "set.1 biquad.2.3.calc=[22,80,0,707,45,128]", "set.1 modc.9=[1,108,02D7280F,0,0,0,0,1E100000]",
        'set.1 system.channel.name.1="Front L"', "set.1 biquad.clickless=1"]
GETS = ["system.key.info", "system.firmware", "system.firmware.port", "system.info", "system.key.info.list",
        "system.feature.attributes", "system.feature.attributes.fr", "system.feature.attributes.hw",
        "system.feature.attributes.oa", "system.feature.attributes.ob", "system.gui.panes", "system.gui.panes.in",
        "system.gui.panes.bq", "system.gui.panes.ou", "system.gui.panes.sy", "gain.out.scale", "gain.in.scale",
        "gain.spdif.scale", "mixer.scale", "gain.out", "gain.in", "gain.spdif", "mute.out", "phase.out", "delay",
        "delay.in", "mixer.position", "mixer.in", "mixer.in.max", "preset.loaded", "preset.select",
        "system.channel.name.*", "system.errors", "system.temperature.celsius", "biquad.clickless", "system.supply",
        "modc.version.attributes", "modc.version.attributes.aa", "modc.version.attributes.ab",
        "modc.version.attributes.ac", "modc.version.attributes.ad", "modc.*", "mixer.*", "biquad.*"]


def main():
    exe, flavour = sys.argv[1], sys.argv[2]
    lines = PRE + ["1|" + s for s in SETS] + ["1|get.1 " + g for g in GETS]
    p = subprocess.run([exe], input="\n".join(lines) + "\n", capture_output=True, text=True, timeout=60, check=True)
    blocks = p.stdout.split("--\n")
    answers = {}
    assert blocks[-1].strip() == ""
    for g, block in zip(GETS, blocks[-len(GETS) - 1:-1]):  # one block per input line, counted from the end
        text = "".join(l[4:] for l in block.splitlines() if l.startswith("@0: "))
        answers["get.1 " + g] = [x for x in text.replace("\\r", "").split("\\n") if x.strip()]
    json.dump({"flavour": flavour, "source": "forge-dsp-firmware tests/native", "answers": answers}, sys.stdout, indent=0)


if __name__ == "__main__":
    main()

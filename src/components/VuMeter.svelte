<script lang="ts">
  import { untrack } from "svelte";
  import { app, inName, meter } from "../lib/app.svelte";
  import { INPUT_PAIRS, vuSum, vuToDb } from "../lib/device";
  import { t } from "../lib/i18n/index.svelte";

  // The header shows the sum of all outputs (system.vu.out, forge-dsp-firmware#52): left = power sum
  // of outputs 1,3,5,7, right = 2,4,6,8. Firmware without output levels: the loudest input pair.
  // The firmware delivers RMS values a few times per second; the bars rise at once and fall slowly.
  const FLOOR = $derived(meter.floor);  // setting "Pegelanzeige ab" (overview)
  const FALL_DB = 3;  // per update
  let shown = $state<[number, number]>([-200, -200]);
  let label = $state("");
  const outputs = $derived(app.device.vuOut !== null && meter.source === "outputs");
  const sideList = (side: number) => meter.sides.map((x, i) => (x === side ? i + 1 : 0)).filter(Boolean).join("/") || t("common.none");

  $effect(() => {
    const out = app.device.vuOut, vu = app.device.vu;
    let now: [number, number];
    if (out && meter.source === "outputs") {
      now = [vuToDb(vuSum(out, 0, meter.sides)), vuToDb(vuSum(out, 1, meter.sides))];
      label = t("common.outputs");
    } else if (vu) {
      let best = INPUT_PAIRS[INPUT_PAIRS.length - 1];
      let bestDb = -Infinity;
      for (const p of INPUT_PAIRS) {
        const d = Math.max(vuToDb(vu[p.in[0] - 1] ?? 0), vuToDb(vu[p.in[1] - 1] ?? 0));
        if (d > bestDb) { bestDb = d; best = p; }
      }
      // "Eingang 2" / "Digital" (default names, either language), otherwise the user's names
      const [l, r] = best.in.map(inName);
      const common = l.replace(/ L$/, "");
      label = bestDb <= FLOOR ? t("common.noSignal") : common !== l && r === `${common} R` ? common : `${l} / ${r}`;
      now = best.in.map((i) => vuToDb(vu[i - 1] ?? 0)) as [number, number];
    } else return;
    const prev = untrack(() => shown);  // not a dependency: only a new reading moves the bars
    shown = [Math.max(now[0], prev[0] - FALL_DB, -200), Math.max(now[1], prev[1] - FALL_DB, -200)];
  });
  const pct = (db: number) => `${Math.max(0, Math.min(100, ((db - FLOOR) / -FLOOR) * 100))}%`;
  const text = $derived(Math.max(...shown) <= FLOOR ? "−∞" : `−${Math.abs(Math.max(...shown)).toFixed(0)}`);
</script>

{#if app.device.vu || app.device.vuOut}
  <div class="vu" title={t("ui.whatRMSDBFSLabel", { what: outputs
      ? t("ui.sumOutputsLeftL", { l: sideList(0), r: sideList(1) }) : t("common.inputLevel"), label })} role="img"
    aria-label="{t("common.level")} {label} {text} dBFS">
    <div class="bars">
      {#each shown as db, i}
        <div class="bar"><span class="ch">{i ? "R" : "L"}</span><div class="rail"><div class="fill" style="width:{pct(db)}"></div></div></div>
      {/each}
    </div>
    <div class="info"><span class="num">{text} dB</span><span class="src">{label}</span></div>
  </div>
{/if}

<style>
  .vu { display: flex; align-items: center; gap: .6rem; }
  .bars { display: grid; gap: 3px; width: 9.5rem; }
  .bar { display: flex; align-items: center; gap: .35rem; }
  .ch { font-size: .6rem; color: var(--faint); width: .5rem; }
  .rail { flex: 1; height: 5px; border-radius: 3px; background: var(--line-strong); overflow: hidden; position: relative; }
  /* the gradient spans the whole rail, the fill reveals it: green-blue up to -12, amber, red at the top */
  .fill { height: 100%; border-radius: 3px; transition: width .18s linear;
    background: linear-gradient(to right, var(--accent) 0, var(--accent) 80%, var(--warn) 80%, var(--warn) 95%, var(--err) 95%);
    background-size: 9.5rem 100%; }
  .info { display: grid; line-height: 1.15; min-width: 4.2rem; }
  .info .num { font-size: .8rem; }
  .src { font-size: .68rem; color: var(--muted); white-space: nowrap; }
  @media (max-width: 40rem) { .info { display: none; } .bars { width: 5.5rem; } .fill { background-size: 5.5rem 100%; } }
</style>

<script lang="ts">
  import { app, meter, outName, resetMeter, setMeter, setVuFloor, VU_FLOORS, type MeterSource } from "../lib/app.svelte";
  import { i18n, LANGS, setLang, t, tk, type Lang, tx } from "../lib/i18n/index.svelte";

  // Settings of this GUI (stored in the browser, not in the Forge).
  const outs = $derived(Math.max(8, app.device.gain.out.length));
  const SIDES = [{ v: 0, t: tk("settings.left") }, { v: 1, t: tk("settings.right") }, { v: -1, t: tk("settings.none") }];
  const setSide = (i: number, v: number) => setMeter(meter.source, meter.sides.map((x, k) => (k === i ? v : x)));
  const noOutputLevels = $derived(app.status === "online" && app.device.vuOut === null);
</script>

<header class="head">
  <h2>{t("common.settings")}</h2>
  <p class="muted">{t("settings.settingsInterfaceTheyApply")}</p>
</header>

<section class="panel box">
  <h3>{t("common.language")}</h3>
  <label class="row">
    <span><strong>{t("settings.languageInterface")}</strong><small class="muted">{t("settings.defaultLanguageBrowser")}</small></span>
    <select value={i18n.lang} onchange={(e) => setLang((e.target as HTMLSelectElement).value as Lang)}>
      {#each LANGS as l}<option value={l.code}>{l.name}</option>{/each}
    </select>
  </label>
</section>

<section class="panel box">
  <h3>{t("settings.levelMeter")}</h3>
  <label class="row">
    <span><strong>{t("settings.barsStartAt")}</strong><small class="muted">{t("settings.lowerAlsoShowsQuiet")}</small></span>
    <select value={meter.floor} onchange={(e) => setVuFloor(Number((e.target as HTMLSelectElement).value))}>
      {#each VU_FLOORS as f}<option value={f}>{f} dBFS</option>{/each}
    </select>
  </label>
</section>

<section class="panel box">
  <h3>{t("settings.meterHeader")}</h3>
  <div class="choice" role="radiogroup" aria-label={t("settings.sourceMeterHeader")}>
    {#each [{ v: "outputs", t: t("settings.sumOutputs"), d: t("settings.powerSumOutputsPer") },
      { v: "inputs", t: t("settings.loudestInputPair"), d: t("settings.inputPairHighestLevel") }] as o}
      <label class="opt" class:on={meter.source === o.v}>
        <input type="radio" name="src" value={o.v} checked={meter.source === o.v}
          onchange={() => setMeter(o.v as MeterSource, meter.sides)} />
        <span><strong>{o.t}</strong><small class="muted">{o.d}</small></span>
      </label>
    {/each}
  </div>
  {#if noOutputLevels}
    <p class="warn small">{t("settings.firmwareDeviceReportsNo")}</p>
  {/if}

  {#if meter.source === "outputs"}
    <table>
      <thead><tr><th>{t("settings.output")}</th>{#each SIDES as s}<th class="c">{tx(s.t)}</th>{/each}</tr></thead>
      <tbody>
        {#each { length: outs } as _, i}
          <tr>
            <td><span class="n num">{i + 1}</span> {outName(i + 1)}</td>
            {#each SIDES as s}
              <td class="c"><input type="radio" name="side{i}" checked={meter.sides[i] === s.v}
                aria-label={t("settings.outputNSide", { n: i + 1, side: tx(s.t) })} onchange={() => setSide(i, s.v)} /></td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <div><button onclick={resetMeter}>{t("settings.defaultLeft13")}</button></div>
  {/if}
</section>

<style>
  .head { margin-bottom: 1rem; }
  .box { padding: .9rem 1rem; display: grid; gap: .8rem; margin-bottom: .75rem; max-width: 46rem; }
  h3 { margin: 0; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .row span, .opt span { display: grid; gap: .1rem; }
  small { font-size: .78rem; }
  select { font: inherit; padding: .3rem .45rem; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--fg); }
  .choice { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
  .opt { display: flex; gap: .6rem; align-items: flex-start; padding: .6rem .75rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); cursor: pointer; }
  .opt.on { border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
  .opt input { margin-top: .2rem; accent-color: var(--accent); }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: .76rem; padding: .3rem .4rem; border-bottom: 1px solid var(--line); }
  td { padding: .3rem .4rem; border-bottom: 1px solid var(--line); }
  .c { text-align: center; width: 5.5rem; }
  td input { accent-color: var(--accent); }
  .n { color: var(--faint); margin-right: .3rem; }
  .warn { color: var(--warn); margin: 0; }
</style>

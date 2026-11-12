<script lang="ts">
  import { app, inName, outName, write } from "../lib/app.svelte";
  import { limitsOf, MIXER_BUS_COLUMNS, MIXER_BUS_ROWS, MIXER_INPUTS, mixerRowOfOutput, sourceNames } from "../lib/device";

  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const positions = $derived(Object.keys(d.mixer.values).map(Number).sort((a, b) => a - b));
  let pos = $state(0);
  $effect(() => {
    if (!positions.includes(pos)) pos = d.mixer.position || positions[0] || 1;
  });
  const grid = $derived(d.mixer.values[pos] ?? {});
  const sources = $derived(sourceNames(d));
  const outs = $derived(d.gain.out.map((_, i) => i + 1));
  const inputs = Array.from({ length: MIXER_INPUTS }, (_, i) => i + 1);
  const BUS = ["Bus A", "Bus B"];

  const has = (c: number, g: number) => grid[c]?.[g] !== undefined;
  function set(c: number, g: number, text: string, el?: HTMLInputElement) {
    const n = Math.round(Number(text.replace(",", ".")));
    if (!Number.isNaN(n)) {
      const v = Math.max(lim.mixer[0], Math.min(lim.mixer[1], n));
      (grid[c] ??= {})[g] = v;
      write(`mixer.${pos}.${c}.${g}`, v);
    }
    if (el) el.value = String(grid[c]?.[g] ?? 0);
  }
  function wheel(e: WheelEvent, c: number, g: number) {
    if (document.activeElement !== e.currentTarget) return;  // only the focused cell, the page must stay scrollable
    e.preventDefault();
    set(c, g, String((grid[c]?.[g] ?? 0) + (e.deltaY < 0 ? 5 : -5)), e.currentTarget as HTMLInputElement);
  }
  function activate() {
    d.mixer.position = pos;
    write("mixer.position", pos);
  }
  function source(v: number) {
    (grid[1] ??= {})[10] = v;
    if (pos === d.mixer.position) d.mixer.input = v;
    write(`mixer.${pos}.1.10`, v);
  }
  const tint = (v: number | undefined) => `--v:${Math.min(100, v ?? 0)}`;
</script>

<header class="head">
  <div>
    <h2>Mixer</h2>
    <p class="muted">Welcher Eingang mit welchem Anteil (0–100 %) auf welchen Ausgang geht. Vier Stellungen lassen sich
      vorbereiten und umschalten, z. B. je Quelle eine.</p>
  </div>
</header>

<div class="bar">
  <div class="tabs" role="tablist" aria-label="Mixer-Stellung">
    {#each positions as p}
      <button role="tab" aria-selected={pos === p} class:on={pos === p} onclick={() => (pos = p)}>
        Stellung {p}{#if d.mixer.position === p}<span class="dot ok" title="aktiv"></span>{/if}</button>
    {/each}
  </div>
  {#if pos === d.mixer.position}
    <span class="muted">Diese Stellung ist aktiv, Änderungen sind sofort zu hören.</span>
  {:else}
    <button class="primary" onclick={activate}>Aktivieren</button>
    <span class="muted">Nicht aktiv: Änderungen werden gespeichert, aber erst nach dem Aktivieren hörbar.</span>
  {/if}
</div>

<section class="panel box">
  <label class="src">
    <span>Digitale Quelle dieser Stellung</span>
    <select value={grid[1]?.[10] ?? 0} onchange={(e) => source(Number(e.currentTarget.value))}>
      {#if !sources.some((s) => s.value === (grid[1]?.[10] ?? 0))}<option value={grid[1]?.[10] ?? 0}>–</option>{/if}
      {#each sources as s}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </label>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="corner">Ziel ↓ &nbsp; Quelle →</th>
          {#each inputs as g}<th title={inName(g)}><span class="num">{g}</span><span class="nm">{inName(g)}</span></th>{/each}
          {#each MIXER_BUS_COLUMNS as g, i}<th class="busc" title="Ausgang des {BUS[i]}"><span class="nm">{BUS[i]}</span></th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each MIXER_BUS_ROWS as c, i}
          <tr class="bus">
            <th scope="row" title="Vorstufe mit eigener Filterkette, lässt sich auf Ausgänge mischen">{BUS[i]}</th>
            {#each inputs as g}
              <td>{#if has(c, g)}<input class="num" class:zero={!grid[c][g]} style={tint(grid[c][g])} value={grid[c][g]} inputmode="numeric"
                aria-label="{inName(g)} auf {BUS[i]}" onchange={(e) => set(c, g, e.currentTarget.value, e.currentTarget)}
                onwheel={(e) => wheel(e, c, g)} />{/if}</td>
            {/each}
            <td class="na" colspan="2"></td>
          </tr>
        {/each}
        {#each outs as o}
          {@const c = mixerRowOfOutput(o)}
          <tr class:pairstart={o % 2 === 1}>
            <th scope="row"><span class="num n">{o}</span>{outName(o)}</th>
            {#each [...inputs, ...MIXER_BUS_COLUMNS] as g}
              <td class:busc={g > MIXER_INPUTS}>{#if has(c, g)}<input class="num" class:zero={!grid[c][g]} style={tint(grid[c][g])} value={grid[c][g]} inputmode="numeric"
                aria-label="{g > MIXER_INPUTS ? BUS[g - MIXER_INPUTS - 1] : inName(g)} auf {outName(o)}"
                onchange={(e) => set(c, g, e.currentTarget.value, e.currentTarget)} onwheel={(e) => wheel(e, c, g)} />{/if}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="muted small">Werte in Prozent, 100 = voller Pegel. Mausrad im angeklickten Feld ändert in 5er-Schritten.
    Bus A und B sind zwei Vorstufen mit eigener Filterkette (unter „Filter & EQ“), deren Ausgang hier auf die Kanäle gemischt wird.</p>
</section>

<style>
  .head { margin-bottom: 1rem; }
  .bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: .75rem; }
  .tabs { display: flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .tabs button { border: 0; border-radius: 0; background: none; padding: .4rem .85rem; color: var(--muted); display: inline-flex; align-items: center; gap: .45rem; }
  .tabs button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--fg); }
  .box { padding: .9rem 1rem; display: grid; gap: .8rem; min-width: 0; }
  .src { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  select { padding: .4rem .6rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); }
  select option { background: var(--bg); }
  .scroll { overflow-x: auto; margin: 0 -.25rem; padding: 0 .25rem; }
  table { border-collapse: separate; border-spacing: 3px; }
  thead th { font-weight: 500; font-size: .78rem; color: var(--muted); padding: 0 .1rem .3rem; min-width: 3.9rem; max-width: 5.5rem; vertical-align: bottom; }
  thead th .num { display: block; color: var(--faint); }
  .nm { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .corner { text-align: left; min-width: 9rem; font-size: .72rem; }
  tbody th { text-align: left; font-weight: 500; white-space: nowrap; padding-right: .75rem; position: sticky; left: 0; background: var(--panel); z-index: 1; }
  tbody th .n { color: var(--faint); margin-right: .5rem; }
  tr.bus th { color: var(--muted); }
  tr.pairstart > * { padding-top: .35rem; }
  td { padding: 0; }
  /* the fuller the cell, the stronger the tint: the routing is readable at a glance */
  td input { width: 100%; min-width: 3.6rem; text-align: center; padding: .35rem .2rem; border-radius: 6px; border: 1px solid var(--line);
    background: color-mix(in srgb, var(--accent) calc(var(--v) * .55%), var(--raised)); color: var(--fg); font-size: .9rem; }
  td input.zero:not(:focus) { color: var(--faint); }
  td input:hover { border-color: var(--line-strong); }
  td input:focus { border-color: var(--accent); outline: none; }
  .busc { border-left: 0; }
  thead .busc, td.busc:first-of-type { padding-left: .5rem; }
  .small { font-size: .8rem; }
</style>

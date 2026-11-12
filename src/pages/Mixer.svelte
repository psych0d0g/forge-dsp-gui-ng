<script lang="ts">
  import { app, inName, inShort, outName, write } from "../lib/app.svelte";
  import { inputSide, inputsLeftFirst, limitsOf, MIXER_BUS_COLUMNS, MIXER_BUS_ROWS, MIXER_INPUTS, mixerRowOfOutput, sourceNames } from "../lib/device";
  import Knob from "../components/Knob.svelte";

  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const profiles = $derived(Object.keys(d.mixer.values).map(Number).sort((a, b) => a - b));
  let profile = $state(0);
  $effect(() => {
    if (!profiles.includes(profile)) profile = d.mixer.position || profiles[0] || 1;
  });
  const grid = $derived(d.mixer.values[profile] ?? {});
  const sources = $derived(sourceNames(d));
  const BUS = ["Bus A", "Bus B"];
  const inputs = inputsLeftFirst(MIXER_INPUTS);  // left before right within each stereo input
  // sources in groups: analog inputs (as many as gain.in has, 6), digital (the rest), the buses
  const analog = $derived(Math.min(MIXER_INPUTS, d.gain.in.length || 6));
  const srcGroups = $derived([
    { label: "Analog", cols: inputs.filter((g) => g <= analog) },
    { label: "Digital", cols: inputs.filter((g) => g > analog) },
    { label: "Bus", cols: MIXER_BUS_COLUMNS },
  ]);
  const groupStart = (g: number) => g === analog + 2 || g === MIXER_INPUTS + 1;  // first column of Digital / Bus

  // Destinations: the two buses, then the outputs; shown two at a time (a stereo pair).
  interface Dest { row: number; label: string; nr: string }
  const dests = $derived<Dest[]>([
    ...MIXER_BUS_ROWS.map((row, i) => ({ row, label: BUS[i], nr: "" })),
    ...d.gain.out.map((_, i) => ({ row: mixerRowOfOutput(i + 1), label: outName(i + 1), nr: String(i + 1) })),
  ]);
  const groups = $derived(Array.from({ length: Math.ceil(dests.length / 2) }, (_, i) => dests.slice(2 * i, 2 * i + 2)));
  let group = $state(1);  // first output pair
  const groupLabel = (g: Dest[]) => (g[0].nr ? `Ausgang ${g.map((x) => x.nr).join(" / ")}` : "Bus A / B");

  // mixer.P.1.10 is the source select of the profile, not a mixer value
  const has = (c: number, g: number) => grid[c]?.[g] !== undefined && !(c === 1 && g === 10);
  const colName = (g: number) => (g > MIXER_INPUTS ? BUS[g - MIXER_INPUTS - 1] : inName(g));
  function set(c: number, g: number, v: number) {
    (grid[c] ??= {})[g] = v;
    write(`mixer.${profile}.${c}.${g}`, v);
  }
  function activate() {
    d.mixer.position = profile;
    write("mixer.position", profile);
  }
  function source(v: number) {
    (grid[1] ??= {})[10] = v;
    if (profile === d.mixer.position) d.mixer.input = v;
    write(`mixer.${profile}.1.10`, v);
  }
</script>

<header class="head">
  <div>
    <h2>Mixer</h2>
    <p class="muted">Welcher Eingang mit welchem Anteil auf welchen Ausgang geht. Vier Profile lassen sich vorbereiten
      und umschalten, z. B. je Quelle eines.</p>
  </div>
</header>

<div class="bar">
  <div class="tabs" role="tablist" aria-label="Mixer-Profil">
    {#each profiles as p}
      <button role="tab" aria-selected={profile === p} class:on={profile === p} onclick={() => (profile = p)}>
        Profil {p}{#if d.mixer.position === p}<span class="dot ok" title="aktiv"></span>{/if}</button>
    {/each}
  </div>
  {#if profile === d.mixer.position}
    <span class="muted">Aktives Profil: Änderungen sind sofort zu hören.</span>
  {:else}
    <button class="primary" onclick={activate}>Aktivieren</button>
    <span class="muted">Nicht aktiv: Änderungen werden gespeichert und erst nach dem Aktivieren hörbar.</span>
  {/if}
  <label class="src">
    <span class="muted">Digitale Quelle</span>
    <select value={grid[1]?.[10] ?? 0} onchange={(e) => source(Number(e.currentTarget.value))}>
      {#if !sources.some((s) => s.value === (grid[1]?.[10] ?? 0))}<option value={grid[1]?.[10] ?? 0}>–</option>{/if}
      {#each sources as s}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </label>
</div>

<div class="layout">
  <!-- routing at a glance; a click selects the destination -->
  <section class="panel map" aria-label="Routing-Übersicht">
    <h3>Routing</h3>
    <div class="maphead"><span></span>{#each [...inputs, ...MIXER_BUS_COLUMNS] as g}<span class="num" class:gs={groupStart(g)} title={colName(g)}>{g > MIXER_INPUTS ? "AB"[g - MIXER_INPUTS - 1] : inputSide(g)}</span>{/each}</div>
    {#each groups as grp, gi}
      <button class="maprow" class:on={group === gi} aria-pressed={group === gi} onclick={() => (group = gi)}>
        {#each grp as dst}
          <span class="mapline">
            <span class="mapname">{#if dst.nr}<span class="num n">{dst.nr}</span>{/if}{dst.label}</span>
            {#each [...inputs, ...MIXER_BUS_COLUMNS] as g}
              <span class="cell" class:gs={groupStart(g)} class:none={!has(dst.row, g)} style="--v:{Math.min(100, grid[dst.row]?.[g] ?? 0)}"
                title="{colName(g)} → {dst.label}: {grid[dst.row]?.[g] ?? '–'}"></span>
            {/each}
          </span>
        {/each}
      </button>
    {/each}
  </section>

  <section class="panel strips">
    <h3>{groupLabel(groups[group] ?? groups[0])}</h3>
    {#each groups[group] ?? [] as dst}
      <div class="strip">
        <div class="dst">{#if dst.nr}<span class="chn num">{dst.nr}</span>{/if}<strong>{dst.label}</strong></div>
        <div class="knobs">
          {#each srcGroups as sg}
            {#if sg.cols.some((g) => has(dst.row, g))}
              <div class="sgroup">
                <span class="sglabel">{sg.label}</span>
                <div class="sgknobs">
                  {#each sg.cols as g}
                    {#if has(dst.row, g)}
                      <Knob value={grid[dst.row][g]} min={lim.mixer[0]} max={lim.mixer[1]} unit="%"
                        caption={g > MIXER_INPUTS ? "AB"[g - MIXER_INPUTS - 1] : inShort(g)}
                        label="{colName(g)} auf {dst.label}" onchange={(v) => set(dst.row, g, v)} />
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
    <p class="muted small">Regler ziehen oder Wert eintippen, 100 % = voller Pegel. Doppelklick schaltet zwischen 0 und 100.
      Bus A und B sind zwei Vorstufen mit eigener Filterkette; ihr Ausgang lässt sich auf jeden Kanal mischen.</p>
  </section>
</div>

<style>
  .head { margin-bottom: 1rem; }
  .bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: .75rem; }
  .tabs { display: flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .tabs button { border: 0; border-radius: 0; background: none; padding: .4rem .85rem; color: var(--muted); display: inline-flex; align-items: center; gap: .45rem; }
  .tabs button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--fg); }
  .src { display: flex; align-items: center; gap: .6rem; margin-left: auto; }
  select { padding: .4rem .6rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); }
  select option { background: var(--bg); }

  .layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .75rem; align-items: start; }
  .map { padding: .85rem .6rem .6rem; display: grid; gap: 2px; }
  .map h3 { padding: 0 .4rem .4rem; }
  .maphead, .mapline { display: grid; grid-template-columns: 7.5rem repeat(6, .8rem) 1.15rem .8rem 1.15rem .8rem; gap: 3px; align-items: center; }
  .maphead { padding: 0 .4rem; font-size: .62rem; color: var(--faint); text-align: center; }
  .maprow { display: grid; gap: 3px; padding: .3rem .4rem; border: 1px solid transparent; background: none; border-radius: 8px; text-align: left; font: inherit; }
  .maprow.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .mapname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .8rem; }
  .mapname .n { color: var(--faint); margin-right: .4rem; }
  .cell { height: .85rem; border-radius: 3px; background: color-mix(in srgb, var(--accent) calc(var(--v) * 1%), var(--raised)); border: 1px solid var(--line); }
  .cell.none { visibility: hidden; }

  .strips { padding: .9rem 1rem; display: grid; gap: .9rem; min-width: 0; }
  .strip { display: grid; gap: .5rem; padding-bottom: .9rem; border-bottom: 1px solid var(--line); }
  .dst { display: flex; align-items: center; gap: .55rem; }
  .chn { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 6px; background: var(--raised); color: var(--muted); font-size: .8rem; }
  .knobs { display: flex; flex-wrap: wrap; gap: .6rem .5rem; align-items: flex-start; }
  /* analog, digital and bus sources as separate blocks */
  .sgroup { display: grid; gap: .3rem; padding: .45rem .35rem .3rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
  .sglabel { font-size: .66rem; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-left: .35rem; }
  .sgknobs { display: flex; flex-wrap: wrap; gap: .4rem .1rem; }
  .gs { margin-left: .35rem; }
  .small { font-size: .8rem; }
  @media (max-width: 68rem) { .layout { grid-template-columns: minmax(0, 1fr); } .src { margin-left: 0; } }
</style>

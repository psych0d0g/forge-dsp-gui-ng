<script lang="ts">
  import { app, inDefault, inNameRaw, outName, outNameRaw, setInName, setOutName, write } from "../lib/app.svelte";
  import { inputsLeftFirst, limitsOf, MIXER_BUS_COLUMNS, MIXER_BUS_ROWS, MIXER_INPUTS, mixerRowOfOutput, sourceNames, sumsActive,
    sumsMapping, sumsShares } from "../lib/device";
  import Knob from "../components/Knob.svelte";
  import DbFader from "../components/DbFader.svelte";
  import NameField from "../components/NameField.svelte";
  import Icon from "../components/Icon.svelte";

  // Laid out as a mixing console, top to bottom as the signal flows: every input is a channel
  // strip (a column) with its level fader at the head and below it its sends to each output; the
  // outputs are the fader bank at the bottom.
  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const profiles = $derived(Object.keys(d.mixer.values).map(Number).sort((a, b) => a - b));
  let profile = $state(0);
  $effect(() => {
    if (!profiles.includes(profile)) profile = d.mixer.position || profiles[0] || 1;
  });
  const grid = $derived(d.mixer.values[profile] ?? {});
  const sources = $derived(sourceNames(d));
  const analogCount = $derived(Math.min(MIXER_INPUTS, d.gain.in.length || 6));
  const analog = $derived(inputsLeftFirst(analogCount));                                  // left before right
  const digital = $derived(inputsLeftFirst(MIXER_INPUTS).filter((g) => g > analogCount));
  const outs = $derived(d.gain.out.map((_, i) => i + 1));
  const SUM = ["A", "B"];

  const val = (c: number, g: number) => grid[c]?.[g];
  const has = (c: number, g: number) => grid[c]?.[g] !== undefined && !(c === 1 && g === 10);  // mixer.P.1.10 = source select
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

  // "All Over": the two signal sums as a common path in front of all outputs. Off: its controls
  // stay in place but are locked. Switching glides the shares to 0, or back to what they were.
  let gliding = $state(false);
  const remembered: Record<number, Record<string, number> | undefined> = {};
  let wantOn = $state<boolean | null>(null);
  const allOver = $derived(wantOn ?? sumsActive(d, profile));
  $effect(() => { profile; wantOn = null; });
  function toggleAllOver() {
    if (gliding) return;
    const on = !allOver, p = profile;
    // off: remember the shares set on the device; on: bring exactly those back
    const key = `forge-allover:${d.identity.keyInfo.split("-")[3] || "unknown"}:${p}`;
    if (!on) {
      remembered[p] = sumsShares(d, p);
      try { localStorage.setItem(key, JSON.stringify(remembered[p])); } catch { /* kept for this session */ }
    } else if (!remembered[p]) {
      try { remembered[p] = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined; } catch { /* none */ }
    }
    const moves = sumsMapping(d, p, on, remembered[p]).map(([c, g, to]) => ({ c, g, from: d.mixer.values[p][c][g], to }));
    wantOn = on;
    if (!moves.length) return;
    gliding = true;
    const t0 = performance.now(), ms = 600;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = k * k * (3 - 2 * k);  // ease in and out
      for (const m of moves) {
        const v = Math.round(m.from + (m.to - m.from) * e);
        if (d.mixer.values[p][m.c][m.g] !== v) {
          d.mixer.values[p][m.c][m.g] = v;
          write(`mixer.${p}.${m.c}.${m.g}`, v);  // the level glides on the device as well
        }
      }
      if (k < 1) requestAnimationFrame(step);
      else gliding = false;
    };
    requestAnimationFrame(step);
  }
  const sumLocked = $derived(!allOver || gliding);

  // input level and output controls
  function inGain(g: number, raw: number) {
    if (g <= analogCount) { d.gain.in[g - 1] = raw; write(`gain.in.${g}`, raw); }
    else { d.gain.spdif[g - analogCount - 1] = raw; write(`gain.spdif.${g - analogCount}`, raw); }
  }
  const inScale = (g: number) => (g <= analogCount ? d.scales.in : d.scales.spdif);
  const inValue = (g: number) => (g <= analogCount ? d.gain.in[g - 1] : d.gain.spdif[g - analogCount - 1]);
  let linked = $state<Record<number, boolean>>({});
  function outGain(ch: number, raw: number) {
    const sc = d.scales.out!, pair = Math.floor((ch - 1) / 2), delta = raw - d.gain.out[ch - 1];
    for (const c of linked[pair] ? [2 * pair + 1, 2 * pair + 2] : [ch]) {
      if (c > d.gain.out.length) continue;
      const v = c === ch ? raw : Math.min(sc.max, Math.max(sc.min, d.gain.out[c - 1] + delta));
      d.gain.out[c - 1] = v;
      write(`gain.out.${c}`, v);
    }
  }
  function toggle(kind: "mute" | "phase", ch: number) {
    const v = d[kind][ch - 1] ? 0 : 1;
    d[kind][ch - 1] = v;
    write(`${kind}.out.${ch}`, v);
  }
  const short = (g: number) => inDefault(g).replace(/^Eingang |^Digital /, "");
</script>

<header class="head">
  <div>
    <h2>Mixer</h2>
    <p class="muted">Von oben nach unten wie das Signal läuft: Eingangspegel, Routing auf die Ausgänge, Ausgangspegel. Jede Spalte
      ist ein Eingang.</p>
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
    <span class="muted">Nicht aktiv: erst nach dem Aktivieren hörbar.</span>
  {/if}
  <button class="allover" class:on={allOver} role="switch" aria-checked={allOver} disabled={gliding} onclick={toggleAllOver}
    title="Gemeinsamer Signalweg mit eigener Filterkette vor allen Ausgängen (Summe A links, Summe B rechts)">
    <span class="sw"></span>All Over</button>
  <label class="src">
    <span class="muted">Digitale Quelle</span>
    <select value={val(1, 10) ?? 0} onchange={(e) => source(Number(e.currentTarget.value))}>
      {#if !sources.some((s) => s.value === (val(1, 10) ?? 0))}<option value={val(1, 10) ?? 0}>–</option>{/if}
      {#each sources as s}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </label>
</div>

<section class="panel console">
  <div class="desk" style="--na:{analog.length}; --nd:{digital.length}">
    <!-- group titles -->
    <span></span>
    <span class="gtitle" style="grid-column: span {analog.length}">Analog</span><span></span>
    <span class="gtitle" style="grid-column: span {digital.length}">Digital</span><span></span>
    <span class="gtitle" class:locked={!allOver} style="grid-column: span 2">All Over</span>

    <!-- channel names -->
    <span class="rlabel muted">Kanal</span>
    {#each analog as g}<span class="cname"><NameField value={inNameRaw(g)} placeholder={short(g)} label="Name {inDefault(g)}" onchange={(v) => setInName(g, v)} /></span>{/each}
    <span></span>
    {#each digital as g}<span class="cname"><NameField value={inNameRaw(g)} placeholder={short(g)} label="Name {inDefault(g)}" onchange={(v) => setInName(g, v)} /></span>{/each}
    <span></span>
    {#each SUM as n}<span class="cname fixed" class:locked={!allOver} title="Summe {n}">{n}</span>{/each}

    <!-- input level faders at the head of each strip -->
    <span class="rlabel faderrow muted">Eingangs&shy;pegel</span>
    {#each analog as g}<span class="cell faderrow">{#if inScale(g)}<DbFader value={inValue(g)} scale={inScale(g)!} label="Pegel {inDefault(g)}" onchange={(r) => inGain(g, r)} />{/if}</span>{/each}
    <span class="faderrow"></span>
    {#each digital as g}<span class="cell faderrow">{#if inScale(g)}<DbFader value={inValue(g)} scale={inScale(g)!} label="Pegel {inDefault(g)}" onchange={(r) => inGain(g, r)} />{/if}</span>{/each}
    <span class="faderrow"></span><span class="faderrow"></span><span class="faderrow"></span>

    <!-- sends: one row per output -->
    {#each outs as o}
      {@const c = mixerRowOfOutput(o)}
      <span class="rlabel" class:pairstart={o % 2 === 1}><span class="arrow">→</span><span class="num n">{o}</span><span class="rn">{outName(o)}</span></span>
      {#each analog as g}<span class="cell" class:pairstart={o % 2 === 1}>{#if has(c, g)}<Knob size={40} value={val(c, g)!} min={lim.mixer[0]} max={lim.mixer[1]}
        label="{inDefault(g)} auf {outName(o)}" onchange={(v) => set(c, g, v)} />{/if}</span>{/each}
      <span></span>
      {#each digital as g}<span class="cell" class:pairstart={o % 2 === 1}>{#if has(c, g)}<Knob size={40} value={val(c, g)!} min={lim.mixer[0]} max={lim.mixer[1]}
        label="{inDefault(g)} auf {outName(o)}" onchange={(v) => set(c, g, v)} />{/if}</span>{/each}
      <span></span>
      {#each MIXER_BUS_COLUMNS as g, i}<span class="cell" class:pairstart={o % 2 === 1}>{#if has(c, g)}<Knob size={40} value={val(c, g)!} min={lim.mixer[0]} max={lim.mixer[1]}
        disabled={sumLocked} label="Summe {SUM[i]} auf {outName(o)}" onchange={(v) => set(c, g, v)} />{/if}</span>{/each}
    {/each}

    <!-- sends into the sums -->
    {#each MIXER_BUS_ROWS as c, i}
      <span class="rlabel sumrow" class:first={i === 0} class:locked={!allOver}><span class="arrow">→</span><span class="rn">Summe {SUM[i]}</span></span>
      {#each analog as g}<span class="cell sumrow" class:first={i === 0}>{#if has(c, g)}<Knob size={40} value={val(c, g)!} min={lim.mixer[0]} max={lim.mixer[1]}
        disabled={sumLocked} label="{inDefault(g)} auf Summe {SUM[i]}" onchange={(v) => set(c, g, v)} />{/if}</span>{/each}
      <span class="sumrow" class:first={i === 0}></span>
      {#each digital as g}<span class="cell sumrow" class:first={i === 0}>{#if has(c, g)}<Knob size={40} value={val(c, g)!} min={lim.mixer[0]} max={lim.mixer[1]}
        disabled={sumLocked} label="{inDefault(g)} auf Summe {SUM[i]}" onchange={(v) => set(c, g, v)} />{/if}</span>{/each}
      <span class="sumrow" class:first={i === 0}></span><span class="sumrow" class:first={i === 0}></span><span class="sumrow" class:first={i === 0}></span>
    {/each}

  </div>
</section>

{#if d.scales.out}
  <section class="panel console outs">
    <h3>Ausgänge</h3>
    <div class="bank">
      {#each outs as o}
        {@const pair = Math.floor((o - 1) / 2)}
        <div class="ostrip" class:gap={o % 2 === 1 && o > 1}>
          <span class="chn num">{o}</span>
          <span class="oname"><NameField value={outNameRaw(o)} placeholder="Ausgang {o}" label="Name Ausgang {o}" onchange={(v) => setOutName(o, v)} /></span>
          <DbFader value={d.gain.out[o - 1]} scale={d.scales.out} dim={!!d.mute[o - 1]} label="Pegel {outName(o)}" onchange={(r) => outGain(o, r)} />
          <div class="obtn">
            <button class="sq mute" class:on={!!d.mute[o - 1]} aria-pressed={!!d.mute[o - 1]} title="Stumm" onclick={() => toggle("mute", o)}>M</button>
            <button class="sq" class:on={!!d.phase[o - 1]} aria-pressed={!!d.phase[o - 1]} title="Polarität drehen (180°)" onclick={() => toggle("phase", o)}>Ø</button>
          </div>
          {#if o % 2 === 1}
            <button class="ghost link" class:on={linked[pair]} aria-pressed={!!linked[pair]} title="Paar {o}/{o + 1} gemeinsam verstellen"
              onclick={() => (linked[pair] = !linked[pair])}><Icon name="link" size={14} /></button>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<p class="muted small foot">Regler ziehen (hoch/runter) oder Wert eintippen, 100 % = voller Pegel. Doppelklick auf einen Drehregler schaltet
  zwischen 0 und 100, auf einen Fader setzt 0 dB. {#if !allOver}„All Over“ ist aus: Die Summen sind gesperrt.{:else}„All Over“ ist an:
  Die Summen liegen mit den Anteilen der Spalten A und B auf den Ausgängen; ihre Filter stehen unter „Filter & EQ“.{/if}</p>

<style>
  .head { margin-bottom: 1rem; }
  .bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: .75rem; }
  .tabs { display: flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .tabs button { border: 0; border-radius: 0; background: none; padding: .4rem .85rem; color: var(--muted); display: inline-flex; align-items: center; gap: .45rem; }
  .tabs button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--fg); }
  .src { display: flex; align-items: center; gap: .6rem; }
  select { padding: .4rem .6rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); }
  select option { background: var(--bg); }
  .allover { margin-left: auto; display: inline-flex; align-items: center; gap: .55rem; padding: .35rem .8rem .35rem .45rem; color: var(--muted); }
  .allover .sw { width: 2rem; height: 1.15rem; border-radius: 99px; background: var(--line-strong); position: relative; transition: background .2s; }
  .allover .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: calc(1.15rem - 4px); height: calc(1.15rem - 4px); border-radius: 50%; background: var(--fg); transition: transform .2s; }
  .allover.on { color: var(--fg); border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .allover.on .sw { background: var(--accent); }
  .allover.on .sw::after { transform: translateX(.85rem); }
  .allover:disabled { opacity: 1; }

  /* the desk: one grid, so every control of a channel sits in its column */
  .console { padding: .9rem 1rem; overflow-x: auto; flex: none; }
  .desk { display: grid; align-items: center; justify-items: center; row-gap: .15rem; width: max-content;
    grid-template-columns: 10.5rem repeat(var(--na), 3.9rem) 1.1rem repeat(var(--nd), 3.9rem) 1.1rem repeat(2, 3.9rem); }
  .gtitle { justify-self: stretch; text-align: center; font-size: .68rem; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
    padding: .25rem 0; border-radius: 7px 7px 0 0; background: var(--raised); border-bottom: 2px solid var(--line-strong); }
  .desk > span:empty { justify-self: stretch; }
  .cname { width: 100%; padding: 0 .1rem; font-size: .8rem; text-align: center; }
  .cname :global(input) { text-align: center; margin: 0; padding: .15rem .1rem; }
  .cname.fixed { color: var(--fg); padding: .2rem 0; }
  .locked { opacity: .45; }
  .rlabel { justify-self: stretch; display: flex; align-items: baseline; gap: .4rem; padding-right: .6rem; white-space: nowrap; overflow: hidden; position: sticky; left: 0; background: var(--panel); z-index: 1; align-self: stretch; align-items: center; }
  .arrow { color: var(--faint); }
  .rlabel .n { color: var(--faint); width: .8rem; }
  .rn { overflow: hidden; text-overflow: ellipsis; }
  .cell { display: grid; place-items: center; }
  .pairstart { margin-top: .5rem; }
  .sumrow.first { margin-top: .6rem; padding-top: .6rem; border-top: 1px dashed var(--line-strong); justify-self: stretch; }
  .sumrow { justify-self: stretch; }
  .faderrow { margin-bottom: .5rem; padding: .5rem 0 .6rem; border-bottom: 1px solid var(--line-strong); justify-self: stretch; align-self: stretch; }
  .rlabel.faderrow { align-items: flex-start; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }

  .outs { margin-top: .75rem; display: grid; gap: .6rem; }
  .bank { display: flex; gap: .35rem; padding-left: 10.5rem; width: max-content; }
  .ostrip { width: 4.6rem; display: grid; justify-items: center; gap: .3rem; padding: .5rem .2rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); position: relative; }
  .ostrip.gap { margin-left: .9rem; }
  .chn { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 6px; background: var(--panel); color: var(--muted); font-size: .8rem; }
  .oname { width: 100%; font-size: .78rem; }
  .oname :global(input) { text-align: center; margin: 0; padding: .15rem .1rem; }
  .obtn { display: flex; gap: .25rem; }
  .sq { width: 1.8rem; height: 1.8rem; padding: 0; font-weight: 650; color: var(--muted); font-size: .85rem; }
  .sq.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--accent); }
  .sq.mute.on { background: color-mix(in srgb, var(--err) 22%, transparent); border-color: var(--err); color: var(--err); }
  .link { position: absolute; right: -1.05rem; top: 45%; z-index: 1; padding: .15rem; color: var(--faint); background: var(--panel); border: 1px solid var(--line); border-radius: 50%; display: grid; }
  .link.on { color: var(--accent); border-color: var(--accent); }
  .small { font-size: .8rem; }
  .foot { margin-top: .6rem; }
  @media (max-width: 52rem) { .desk { grid-template-columns: 7rem repeat(var(--na), 3.9rem) 1.1rem repeat(var(--nd), 3.9rem) 1.1rem repeat(2, 3.9rem); } .bank { padding-left: 0; } }
</style>

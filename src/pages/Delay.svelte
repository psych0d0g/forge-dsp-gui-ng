<script lang="ts">
  import { app, inDefault, inName, outName, write } from "../lib/app.svelte";
  import { alignFromDistances, cmToSamples, delayGroups, delayMax, inputDelayGroup, inputsLeftFirst, msToSamples, samplesToCm,
    samplesToMs, type DelayGroup } from "../lib/device";
  import VFader from "../components/VFader.svelte";

  // Laid out like the mixer: one strip per channel with an upright fader, grouped by the delay
  // memory the channels share (the inputs, and each block of four outputs).
  type Unit = "ms" | "cm" | "samples";
  let unit = $state<Unit>("ms");
  const d = $derived(app.device);
  const rate = $derived(d.identity.sampleRate || 96000);
  const outGroups = $derived(delayGroups(d));
  const inGroup = $derived(inputDelayGroup(d));
  const inOrder = $derived(inGroup ? inputsLeftFirst(inGroup.channels.length) : []);  // left before right

  const U = $derived(unit === "samples" ? "S" : unit);
  const show = (n: number) => (unit === "ms" ? samplesToMs(n, rate).toFixed(2) : unit === "cm" ? samplesToCm(n, rate).toFixed(1) : String(n));
  const other = (n: number) => (unit === "cm" ? `${samplesToMs(n, rate).toFixed(2)} ms` : `${samplesToCm(n, rate).toFixed(1)} cm`);
  const parse = (t: string) => {
    const v = Number(t.replace(",", "."));
    if (Number.isNaN(v) || v < 0) return null;
    return unit === "ms" ? msToSamples(v, rate) : unit === "cm" ? cmToSamples(v, rate) : Math.round(v);
  };
  // The memory allows 60 ms, a car needs a few: the faders cover 15 ms (or the largest value in
  // use), larger values can be typed.
  const all = $derived([...d.delay.out, ...(inGroup ? d.delay.in.slice(0, inGroup.channels.length) : [])]);
  const span = $derived(Math.min(5840, Math.max(msToSamples(15, rate), ...all)));

  type Side = "in" | "out";
  const list = (side: Side) => (side === "in" ? d.delay.in : d.delay.out);
  function set(side: Side, ch: number, samples: number, g: DelayGroup) {
    const v = Math.max(0, Math.min(delayMax(d, g, ch, list(side)), Math.round(samples)));
    list(side)[ch - 1] = v;
    write(side === "in" ? `delay.in.${ch}` : `delay.${ch}`, v);
  }
  function typed(e: Event, side: Side, ch: number, g: DelayGroup) {
    const el = e.currentTarget as HTMLInputElement;
    const v = parse(el.value);
    if (v !== null) set(side, ch, v, g);
    el.value = show(list(side)[ch - 1] ?? 0);
  }
  const used = (side: Side, g: DelayGroup) => g.channels.reduce((a, c) => a + (list(side)[c - 1] ?? 0), 0);

  // time alignment of the outputs from the distances to the listening position
  let dist = $state<Record<number, string>>({});
  const wanted = $derived(alignFromDistances(d.delay.out.map((_, i) => {
    const v = Number((dist[i + 1] ?? "").replace(",", "."));
    return v > 0 ? v : null;
  }), rate));
  const anyDist = $derived(Object.values(dist).some((t) => Number(t.replace(",", ".")) > 0));
  const fits = $derived(outGroups.every((g) => g.channels.reduce((a, c) => a + wanted[c - 1], 0) <= g.budget));
  function applyDistances() {
    // first down, then up: the memory of a DSP is never exceeded on the way
    const order = wanted.map((w, i) => ({ ch: i + 1, w })).sort((a, b) => (a.w - d.delay.out[a.ch - 1]) - (b.w - d.delay.out[b.ch - 1]));
    for (const { ch, w } of order) set("out", ch, w, outGroups.find((g) => g.channels.includes(ch))!);
  }
</script>

{#snippet strip(side: Side, ch: number, g: DelayGroup, nr: string, name: string)}
  {@const v = list(side)[ch - 1] ?? 0}
  <div class="strip" class:zero={!v}>
    <span class="chn num">{nr}</span>
    <span class="sname" title={name}>{name}</span>
    <VFader frac={v / span} label="Laufzeit {name}" valuetext="{show(v)} {U}"
      onfrac={(f) => set(side, ch, f * span, g)} onstep={(dir) => set(side, ch, v + dir * (unit === "samples" ? 1 : Math.max(1, Math.round(rate / 10000))), g)} />
    <label class="val num"><input value={show(v)} onchange={(e) => typed(e, side, ch, g)} aria-label="Laufzeit {name} in {U}" /><span>{U}</span></label>
    <span class="alt num">{unit === "samples" ? `${samplesToMs(v, rate).toFixed(2)} ms` : other(v)}</span>
    {#if side === "out"}
      <label class="dist" title="Abstand vom Hörplatz zum Lautsprecher">
        <input class="num" inputmode="decimal" placeholder="–" bind:value={dist[ch]} aria-label="Abstand {name} in cm" /><span>cm</span></label>
      <span class="want num">{anyDist ? `→ ${show(wanted[ch - 1])}` : ""}</span>
    {/if}
  </div>
{/snippet}

{#snippet meter(side: Side, g: DelayGroup)}
  {@const u = used(side, g)}
  <div class="meter" title="Die Kanäle dieser Gruppe teilen sich einen Speicher für die Verzögerung">
    <div class="bar"><span style="width:{Math.min(100, (u / g.budget) * 100)}%"></span></div>
    <span class="num">{show(u)} / {show(g.budget)} {U}</span>
  </div>
{/snippet}

<header class="head">
  <div>
    <h2>Laufzeit</h2>
    <p class="muted">Verzögerung je Eingang und je Ausgang. An den Ausgängen gleicht sie die Wege der Lautsprecher zum Hörplatz aus, an
      den Eingängen den Versatz zwischen Quellen.</p>
  </div>
  <div class="units" role="group" aria-label="Einheit">
    {#each [["ms", "ms"], ["cm", "cm"], ["samples", "Samples"]] as [u, t]}
      <button class:on={unit === u} aria-pressed={unit === u} onclick={() => (unit = u as Unit)}>{t}</button>
    {/each}
  </div>
</header>

<section class="panel desk">
  {#if inGroup}
    <div class="group">
      <div class="ghead"><h3>Eingänge</h3>{@render meter("in", inGroup)}</div>
      <div class="strips">
        {#each inOrder as n}{@render strip("in", n, inGroup, inDefault(n).replace(/^Eingang /, ""), inName(n))}{/each}
      </div>
    </div>
  {/if}
  {#each outGroups as g}
    <div class="group">
      <div class="ghead"><h3>Ausgänge {g.channels[0]}–{g.channels[g.channels.length - 1]}</h3>{@render meter("out", g)}</div>
      <div class="strips">
        {#each g.channels as ch}{@render strip("out", ch, g, String(ch), outName(ch))}{/each}
      </div>
    </div>
  {/each}
</section>

<div class="foot">
  <p class="muted small">Fader ziehen oder Wert eintippen. Die Fader reichen bis {show(span)} {U}, größere Werte lassen sich eintippen.
    Unter jedem Ausgang: Abstand vom Hörplatz zum Lautsprecher in cm. Der entfernteste bekommt keine Verzögerung, alle anderen so viel, wie ihr
    Schall zu früh ankäme (343 m/s).</p>
  <div class="apply">
    {#if anyDist && !fits}<span class="warn">Die Abstände brauchen mehr Verzögerung, als ein Ausgangsblock hergibt.</span>{/if}
    <button class="primary" disabled={!anyDist || !fits} onclick={applyDistances}>Abstände übernehmen</button>
  </div>
</div>

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .units { display: flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .units button { border: 0; border-radius: 0; background: none; padding: .35rem .8rem; color: var(--muted); }
  .units button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--fg); }

  .desk { padding: .9rem 1rem; display: flex; gap: 1rem; overflow-x: auto; flex: none; align-items: flex-start; }
  .group { display: grid; gap: .55rem; flex: none; }
  .ghead { display: grid; gap: .3rem; padding: .3rem .5rem .4rem; border-radius: 8px 8px 0 0; background: var(--raised); border-bottom: 2px solid var(--line-strong); }
  .ghead h3 { text-align: center; }
  .meter { display: grid; gap: .15rem; justify-items: center; font-size: .68rem; color: var(--muted); }
  .bar { width: 100%; height: 4px; border-radius: 2px; background: var(--line-strong); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .strips { display: flex; gap: .3rem; }
  .strip { width: 4.35rem; display: grid; justify-items: center; gap: .25rem; padding: .5rem .2rem .45rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
  .chn { min-width: 1.5rem; height: 1.5rem; padding: 0 .3rem; display: grid; place-items: center; border-radius: 6px; background: var(--panel); color: var(--muted); font-size: .78rem; }
  .sname { max-width: 100%; font-size: .78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .val { display: flex; align-items: baseline; gap: .1rem; font-size: .68rem; color: var(--muted); }
  .val input { width: 2.9rem; text-align: center; border: 1px solid transparent; background: none; padding: .1rem; border-radius: 6px; font: inherit; font-size: .88rem; color: var(--fg); }
  .val input:hover { border-color: var(--line-strong); }
  .val input:focus { border-color: var(--accent); outline: none; background: var(--panel); }
  .zero .val input:not(:focus) { color: var(--faint); }
  .alt { font-size: .66rem; color: var(--faint); }
  .dist { display: flex; align-items: baseline; gap: .15rem; font-size: .66rem; color: var(--muted); margin-top: .35rem; padding-top: .4rem; border-top: 1px dashed var(--line-strong); }
  .dist input { width: 2.7rem; text-align: center; padding: .15rem .1rem; font-size: .82rem; }
  .want { font-size: .66rem; color: var(--accent); min-height: 1em; }
  .foot { margin-top: .7rem; display: flex; gap: 1.5rem; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .foot p { flex: 1 1 28rem; margin: 0; }
  .apply { display: flex; align-items: center; gap: .9rem; }
  .small { font-size: .8rem; }
  .warn { color: var(--warn); }
</style>

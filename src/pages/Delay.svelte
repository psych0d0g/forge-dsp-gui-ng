<script lang="ts">
  import { app, write } from "../lib/app.svelte";
  import { alignFromDistances, cmToSamples, delayGroups, delayMax, msToSamples, samplesToCm, samplesToMs } from "../lib/device";
  import Slider from "../components/Slider.svelte";

  type Unit = "ms" | "cm" | "samples";
  let unit = $state<Unit>("ms");
  const d = $derived(app.device);
  const rate = $derived(d.identity.sampleRate || 96000);
  const groups = $derived(delayGroups(d));
  let dist = $state<Record<number, string>>({});

  const show = (n: number) => (unit === "ms" ? samplesToMs(n, rate).toFixed(2) : unit === "cm" ? samplesToCm(n, rate).toFixed(1) : String(n));
  const parse = (t: string) => {
    const v = Number(t.replace(",", "."));
    if (Number.isNaN(v) || v < 0) return null;
    return unit === "ms" ? msToSamples(v, rate) : unit === "cm" ? cmToSamples(v, rate) : Math.round(v);
  };
  function set(ch: number, samples: number, max: number) {
    const v = Math.max(0, Math.min(max, samples));
    d.delay.out[ch - 1] = v;
    write(`delay.${ch}`, v);
  }
  function typed(e: Event, ch: number, max: number) {
    const el = e.currentTarget as HTMLInputElement;
    const v = parse(el.value);
    if (v !== null) set(ch, v, max);
    el.value = show(d.delay.out[ch - 1]);
  }
  const groupOf = (ch: number) => groups.find((g) => g.channels.includes(ch))!;
  // The pool allows 60 ms, a car needs a few: the slider covers 15 ms (or the largest value in
  // use), larger values can be typed.
  const sliderMax = $derived(Math.min(5840, Math.max(msToSamples(15, rate), ...d.delay.out)));
  const used = (chs: number[]) => chs.reduce((a, c) => a + (d.delay.out[c - 1] ?? 0), 0);

  // time alignment from distances
  const wanted = $derived(alignFromDistances(d.delay.out.map((_, i) => {
    const v = Number((dist[i + 1] ?? "").replace(",", "."));
    return v > 0 ? v : null;
  }), rate));
  const anyDist = $derived(Object.values(dist).some((t) => Number(t.replace(",", ".")) > 0));
  const fits = $derived(groups.every((g) => g.channels.reduce((a, c) => a + wanted[c - 1], 0) <= g.budget));
  function applyDistances() {
    // first down, then up: the pool of a DSP is never exceeded on the way
    const order = wanted.map((w, i) => ({ ch: i + 1, w })).sort((a, b) => (a.w - d.delay.out[a.ch - 1]) - (b.w - d.delay.out[b.ch - 1]));
    for (const { ch, w } of order) set(ch, w, groupOf(ch).budget);
  }
</script>

<header class="head">
  <div>
    <h2>Laufzeit</h2>
    <p class="muted">Verzögerung je Ausgang, damit der Schall aller Lautsprecher gleichzeitig am Hörplatz ankommt.</p>
  </div>
  <div class="units" role="group" aria-label="Einheit">
    {#each [["ms", "ms"], ["cm", "cm"], ["samples", "Samples"]] as [u, t]}
      <button class:on={unit === u} aria-pressed={unit === u} onclick={() => (unit = u as Unit)}>{t}</button>
    {/each}
  </div>
</header>

<div class="cols">
  {#each groups as g}
    <section class="panel box">
      <div class="boxhead">
        <h3>Ausgänge {g.channels[0]}–{g.channels[g.channels.length - 1]}</h3>
        <span class="muted num small" title="Die Kanäle eines DSP teilen sich einen Vorrat an Verzögerung">
          {show(used(g.channels))} von {show(g.budget)} {unit === "samples" ? "" : unit} belegt</span>
      </div>
      {#each g.channels as ch}
        {@const max = delayMax(d, g, ch)}
        <div class="row">
          <span class="chn num">{ch}</span>
          <span class="name">{d.channelNames[ch] || `Ausgang ${ch}`}</span>
          <Slider value={d.delay.out[ch - 1] ?? 0} max={sliderMax} label="Laufzeit Ausgang {ch}"
            onchange={(v) => set(ch, v, max)} />
          <label class="readout num"><input value={show(d.delay.out[ch - 1] ?? 0)} onchange={(e) => typed(e, ch, max)}
            aria-label="Laufzeit Ausgang {ch} in {unit}" /><span>{unit === "samples" ? "S" : unit}</span></label>
        </div>
      {/each}
    </section>
  {/each}
</div>

<section class="panel box align">
  <div class="boxhead"><h3>Aus Abständen berechnen</h3></div>
  <p class="muted">Abstand vom Hörplatz zu jedem Lautsprecher in cm eintragen. Der entfernteste bekommt keine Verzögerung,
    alle anderen so viel, wie ihr Schall zu früh ankäme (Schallgeschwindigkeit 343 m/s).</p>
  <div class="dists">
    {#each d.delay.out as _, i}
      <label><span>{d.channelNames[i + 1] || `Ausgang ${i + 1}`}</span>
        <span class="in"><input class="num" inputmode="decimal" placeholder="–" bind:value={dist[i + 1]} /><span class="muted">cm</span></span>
        <span class="muted num small">{anyDist ? `→ ${show(wanted[i])} ${unit === "samples" ? "S" : unit}` : ""}</span></label>
    {/each}
  </div>
  <div class="foot">
    <button class="primary" disabled={!anyDist || !fits} onclick={applyDistances}>Übernehmen</button>
    {#if anyDist && !fits}<span class="warn">Die Abstände brauchen mehr Verzögerung, als ein DSP hergibt.</span>{/if}
  </div>
</section>

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .units { display: flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .units button { border: 0; border-radius: 0; background: none; padding: .35rem .8rem; color: var(--muted); }
  .units button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--fg); }
  .cols { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr)); }
  .box { padding: .85rem 1rem; display: grid; gap: .35rem; align-content: start; }
  .boxhead { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .small { font-size: .78rem; }
  .row { display: flex; align-items: center; gap: .65rem; min-width: 0; }
  .chn { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 6px; background: var(--raised); color: var(--muted); font-size: .8rem; flex: none; }
  .name { width: 7.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
  .readout { display: flex; align-items: baseline; gap: .25rem; width: 6rem; justify-content: flex-end; color: var(--muted); font-size: .8rem; flex: none; }
  .readout input { width: 4rem; text-align: right; border: 1px solid transparent; background: none; padding: .15rem .25rem; border-radius: 6px; font: inherit; font-size: .95rem; color: var(--fg); }
  .readout input:hover { border-color: var(--line-strong); }
  .align { margin-top: .75rem; gap: .7rem; }
  .dists { display: grid; gap: .5rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); }
  .dists label { display: grid; gap: .15rem; }
  .in { display: flex; align-items: baseline; gap: .35rem; }
  .in input { width: 5.5rem; }
  .foot { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .warn { color: var(--warn); }
  @media (max-width: 40rem) {
    .row { display: grid; grid-template: "n name r" auto "f f f" auto / auto 1fr auto; gap: .1rem .5rem; padding: .25rem 0; }
    .name { width: auto; }
    .row :global(.track) { grid-area: f; }
  }
</style>

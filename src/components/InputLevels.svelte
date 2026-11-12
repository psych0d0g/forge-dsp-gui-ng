<script lang="ts">
  import { app, inDefault, inNameRaw, setInName, write } from "../lib/app.svelte";
  import { inputsLeftFirst } from "../lib/device";
  import NameField from "./NameField.svelte";
  import Fader from "./Fader.svelte";

  const d = $derived(app.device);
  function set(kind: "in" | "spdif", ch: number, raw: number) {
    d.gain[kind][ch - 1] = raw;
    write(`gain.${kind}.${ch}`, raw);
  }
  const analog = $derived(d.gain.in.length);  // inputs are numbered as the mixer columns: analog first, then digital
</script>

<!-- Input levels in front of the mixer: part of the mixer page -->
<section class="panel wrap">
  <div class="wraphead">
    <h3>Eingangspegel</h3>
    <span class="muted small">Pegel vor dem Mixer. Ein Klick auf den Namen benennt den Eingang (bleibt in diesem Browser).</span>
  </div>

<div class="cols">
  {#if d.scales.in && d.gain.in.length}
    <div class="box">
      <h3>Analog</h3>
      {#each inputsLeftFirst(d.gain.in.length) as n}
        <div class="row">
          <span class="name"><NameField value={inNameRaw(n)} placeholder={inDefault(n)} label="Name {inDefault(n)}"
            onchange={(v) => setInName(n, v)} /></span>
          <Fader value={d.gain.in[n - 1]} scale={d.scales.in} label="Pegel {inDefault(n)}" onchange={(r) => set("in", n, r)} /></div>
      {/each}
    </div>
  {/if}
  {#if d.scales.spdif && d.gain.spdif.length}
    <div class="box one">
      <h3>Digital</h3>
      {#each inputsLeftFirst(d.gain.spdif.length) as k}
        {@const n = analog + k}
        <div class="row">
          <span class="name"><NameField value={inNameRaw(n)} placeholder={inDefault(n)} label="Name {inDefault(n)}"
            onchange={(v) => setInName(n, v)} /></span>
          <Fader value={d.gain.spdif[k - 1]} scale={d.scales.spdif} label="Pegel {inDefault(n)}" onchange={(r) => set("spdif", k, r)} /></div>
      {/each}
    </div>
  {/if}
</div>
</section>

<style>
  .wrap { padding: .85rem 1rem; display: grid; gap: .6rem; margin-bottom: .75rem; }
  .wraphead { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  .small { font-size: .8rem; }
  .cols { display: grid; gap: .5rem; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); align-items: start; }
  @media (max-width: 70rem) { .cols { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 40rem) { .box { grid-template-columns: minmax(0, 1fr); } }
  .box { padding: .6rem .8rem; display: grid; gap: .25rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); align-content: start; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 1.5rem; }
  .box h3 { grid-column: 1 / -1; }
  .box.one { grid-template-columns: minmax(0, 1fr); }
  .row { display: flex; align-items: center; gap: .65rem; min-width: 0; }
  .name { width: 7rem; flex: none; }
</style>

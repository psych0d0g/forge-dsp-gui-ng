<script lang="ts">
  import { app, inDefault, inNameRaw, setInName, write } from "../lib/app.svelte";
  import { inputsLeftFirst } from "../lib/device";
  import NameField from "../components/NameField.svelte";
  import Fader from "../components/Fader.svelte";

  const d = $derived(app.device);
  function set(kind: "in" | "spdif", ch: number, raw: number) {
    d.gain[kind][ch - 1] = raw;
    write(`gain.${kind}.${ch}`, raw);
  }
  const analog = $derived(d.gain.in.length);  // inputs are numbered as the mixer columns: analog first, then digital
</script>

<header class="head">
  <h2>Eingänge</h2>
  <p class="muted">Eingangspegel vor dem Mixer. Welche Quelle auf welchen Ausgang geht, legt der Mixer fest. Ein Klick auf den
    Namen benennt den Kanal (Eingangsnamen bleiben in diesem Browser).</p>
</header>

<div class="cols">
  {#if d.scales.in && d.gain.in.length}
    <section class="panel box">
      <h3>Analog</h3>
      {#each inputsLeftFirst(d.gain.in.length) as n}
        <div class="row" class:pairend={n % 2 === 1}>
          <span class="name"><NameField value={inNameRaw(n)} placeholder={inDefault(n)} label="Name {inDefault(n)}"
            onchange={(v) => setInName(n, v)} /></span>
          <Fader value={d.gain.in[n - 1]} scale={d.scales.in} label="Pegel {inDefault(n)}" onchange={(r) => set("in", n, r)} /></div>
      {/each}
    </section>
  {/if}
  {#if d.scales.spdif && d.gain.spdif.length}
    <section class="panel box">
      <h3>Digital (S/PDIF, USB)</h3>
      {#each inputsLeftFirst(d.gain.spdif.length) as k}
        {@const n = analog + k}
        <div class="row">
          <span class="name"><NameField value={inNameRaw(n)} placeholder={inDefault(n)} label="Name {inDefault(n)}"
            onchange={(v) => setInName(n, v)} /></span>
          <Fader value={d.gain.spdif[k - 1]} scale={d.scales.spdif} label="Pegel {inDefault(n)}" onchange={(r) => set("spdif", k, r)} /></div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .head { margin-bottom: 1rem; }
  .cols { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); align-items: start; }
  .box { padding: .85rem 1rem; display: grid; gap: .35rem; }
  .row { display: flex; align-items: center; gap: .65rem; }
  .name { width: 8.5rem; flex: none; }
  .pairend { margin-bottom: .45rem; }
</style>

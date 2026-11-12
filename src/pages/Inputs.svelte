<script lang="ts">
  import { app, write } from "../lib/app.svelte";
  import Fader from "../components/Fader.svelte";

  const d = $derived(app.device);
  function set(kind: "in" | "spdif", ch: number, raw: number) {
    d.gain[kind][ch - 1] = raw;
    write(`gain.${kind}.${ch}`, raw);
  }
  const side = (i: number) => (i % 2 === 0 ? "L" : "R");
</script>

<header class="head">
  <h2>Eingänge</h2>
  <p class="muted">Eingangspegel vor dem Mixer. Welche Quelle auf welchen Ausgang geht, legt der Mixer fest.</p>
</header>

<div class="cols">
  {#if d.scales.in && d.gain.in.length}
    <section class="panel box">
      <h3>Analog</h3>
      {#each d.gain.in as raw, i}
        <div class="row"><span class="name">Kanal {Math.floor(i / 2) + 1} {side(i)}</span>
          <Fader value={raw} scale={d.scales.in} label="Pegel Analog {i + 1}" onchange={(r) => set("in", i + 1, r)} /></div>
      {/each}
    </section>
  {/if}
  {#if d.scales.spdif && d.gain.spdif.length}
    <section class="panel box">
      <h3>Digital (S/PDIF, USB)</h3>
      {#each d.gain.spdif as raw, i}
        <div class="row"><span class="name">Digital {side(i)}</span>
          <Fader value={raw} scale={d.scales.spdif} label="Pegel Digital {i + 1}" onchange={(r) => set("spdif", i + 1, r)} /></div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .head { margin-bottom: 1rem; }
  .cols { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); align-items: start; }
  .box { padding: .85rem 1rem; display: grid; gap: .35rem; }
  .row { display: flex; align-items: center; gap: .65rem; }
  .name { width: 6rem; flex: none; }
</style>

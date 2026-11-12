<script lang="ts">
  import { app, inNameRaw, setInName, write } from "../lib/app.svelte";
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
      {#each d.gain.in as raw, i}
        <div class="row"><span class="chn num">{i + 1}</span>
          <span class="name"><NameField value={inNameRaw(i + 1)} placeholder="Eingang {i + 1}" label="Name Eingang {i + 1}"
            onchange={(n) => setInName(i + 1, n)} /></span>
          <Fader value={raw} scale={d.scales.in} label="Pegel Analog {i + 1}" onchange={(r) => set("in", i + 1, r)} /></div>
      {/each}
    </section>
  {/if}
  {#if d.scales.spdif && d.gain.spdif.length}
    <section class="panel box">
      <h3>Digital (S/PDIF, USB)</h3>
      {#each d.gain.spdif as raw, i}
        <div class="row"><span class="chn num">{analog + i + 1}</span>
          <span class="name"><NameField value={inNameRaw(analog + i + 1)} placeholder="Eingang {analog + i + 1}"
            label="Name Eingang {analog + i + 1}" onchange={(n) => setInName(analog + i + 1, n)} /></span>
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
  .chn { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 6px; background: var(--raised); color: var(--muted); font-size: .8rem; flex: none; }
  .name { width: 8.5rem; flex: none; }
</style>

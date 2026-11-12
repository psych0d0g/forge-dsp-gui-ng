<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { isPort } from "../lib/device";
  import { channelColor } from "../lib/channelColors";
  import PoolPanel from "../components/PoolPanel.svelte";

  const d = $derived(app.device);
  let busy = $state("");
</script>

<header class="head">
  <div>
    <h2>Biquad-Verteilung</h2>
    <p class="muted">Jeder DSP-Kern hat einen gemeinsamen Vorrat an Filterplätzen (Biquads) für seine Kanäle. Hier lässt sich
      einstellen, wie viele jeder Kanal bekommt. Gespeicherte Bänder wandern in allen Presets mit (Band 5 bleibt Band 5);
      fällt ein belegtes Band weg, steht das vor dem Übernehmen da. Zum Übernehmen startet der Forge neu, rund 40 s ohne Ton.</p>
  </div>
</header>

{#if d.pools?.length}
  <PoolPanel colorOf={channelColor} current={0} bind:busy />
{:else if app.status === "online"}
  <section class="panel note">
    <p>{isPort(d) ? "Diese Firmware-Fassung kennt die Biquad-Verteilung noch nicht (ab Port-Firmware mit forge-dsp-firmware#47)."
      : "Die Biquad-Verteilung gibt es nur mit der Port-Firmware; die Original-Firmware hat feste Filterzahlen je Kanal."}</p>
  </section>
{/if}

<style>
  .note { padding: .8rem 1rem; }
  .note p { margin: 0; }
</style>

<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { isPort } from "../lib/device";
  import { channelColor } from "../lib/channelColors";
  import PoolPanel from "../components/PoolPanel.svelte";
  import { t } from "../lib/i18n/index.svelte";

  const d = $derived(app.device);
  let busy = $state("");
</script>

<header class="head">
  <div>
    <h2>{t("common.biquadAllocation")}</h2>
    <p class="muted">{t("biquads.eachDSPCoreHas")}</p>
  </div>
</header>

{#if d.pools?.length}
  <PoolPanel colorOf={channelColor} current={0} bind:busy />
{:else if app.status === "online"}
  <section class="panel note">
    <p>{isPort(d) ? t("biquads.firmwareVersionDoesNot")
      : t("biquads.biquadAllocationNeedsPort")}</p>
  </section>
{/if}

<style>
  .note { padding: .8rem 1rem; }
  .note p { margin: 0; }
</style>

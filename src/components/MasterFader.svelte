<script lang="ts">
  import { app, setMaster } from "../lib/app.svelte";
  import { masterDb, masterOf, masterValue } from "../lib/device";
  import VFader from "./VFader.svelte";
  import { t } from "../lib/i18n/index.svelte";

  // Master volume in the top bar (GUI-#3): the two volume events of the MODC block "Lautstärke",
  // attenuation on top of the preset like the rotary encoder; the stored levels stay as they are.
  // Same fader as on the pages (VFader, horizontal) with the editable dB field of DbFader.
  const MIN_DB = -60;
  const m = $derived(masterOf(app.device));
  const v = $derived(m ? app.device.events[m.odd] : undefined);
  const db = $derived(v === undefined ? null : masterDb(v));
  const text = $derived(db === null ? "–" : db <= MIN_DB ? "−∞" : (db < 0 ? "−" : "") + Math.abs(db).toFixed(1));
  const toDb = (f: number) => Math.round((MIN_DB + f * -MIN_DB) * 2) / 2;
  const put = (d: number) => setMaster(d <= MIN_DB ? 0 : masterValue(Math.min(0, d)));
  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const x = Number(el.value.replace(",", ".").replace("−", "-"));
    if (!Number.isNaN(x)) put(Math.min(0, x));
    el.value = text;
  }
</script>

{#if m}
  <div class="master" title={t("ui.masterVolumeControlBlock", { n: m.block })}>
    <span class="lbl">Master</span>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div ondblclick={() => put(0)}>
      <VFader horizontal frac={db === null ? 0 : (Math.max(MIN_DB, db) - MIN_DB) / -MIN_DB} label={t("ui.masterVolume")} valuetext="{text} dB"
        disabled={db === null} onfrac={(f) => put(toDb(f))} onstep={(d) => db !== null && put(Math.max(MIN_DB, db + d * 0.5))} />
    </div>
    <label class="num val"><input value={text} onchange={typed} aria-label={t("ui.masterDB")} disabled={db === null} /><span>dB</span></label>
  </div>
{:else if app.device.identity.firmware}
  <button class="ghost nomaster" onclick={() => (app.page = "modc")}
    title={t("ui.masterVolumeAddVolume")}>
    {t("ui.setUpMaster")}</button>
{/if}

<style>
  .nomaster { font-size: .78rem; color: var(--muted); }
  .master { display: flex; align-items: center; gap: .45rem; }
  .lbl { font-size: .72rem; color: var(--muted); }
  .val { display: flex; align-items: baseline; gap: .05rem; font-size: .7rem; color: var(--muted); }
  .val input { width: 3.1rem; text-align: center; border: 1px solid transparent; background: none; padding: .1rem; border-radius: 6px;
    font: inherit; font-size: .85rem; color: var(--fg); }
  .val input:hover { border-color: var(--line-strong); }
  .val input:focus { border-color: var(--accent); outline: none; background: var(--raised); }
  @media (max-width: 40rem) { .lbl { display: none; } }
</style>

<script lang="ts">
  import { t } from "../lib/i18n/index.svelte";
  import { saveFile } from "../lib/saveFile";
  import { app, reload, writeOnce, writeRaw } from "../lib/app.svelte";
  import { entriesToWrite, parseCfg, restorable, stateToEntries, toCfg, type Entry } from "../lib/device";

  const d = $derived(app.device);
  const count = $derived(d.identity.presets || 4);
  const loaded = $derived(d.preset.loaded);
  let busy = $state("");
  let note = $state("");

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function run(what: string, fn: () => Promise<string | void>) {
    if (busy) return;
    busy = what;
    note = "";
    try {
      note = (await fn()) ?? "";
    } finally {
      busy = "";
    }
  }
  const load = (n: number) => run(t("presets.loadingPresetN", { n: n + 1 }), async () => {
    const err = await writeOnce("preset.loaded", n);
    if (err) return t("presets.loadRefusedErr", { err });
    await sleep(2500);  // the device mutes, loads and unmutes
    await reload();
  });
  const copy = (n: number) => run(t("presets.copyingPresetN", { n: n + 1 }), async () => {
    if (!confirm(t("presets.copyLoadedPresetPreset", { a: loaded! + 1, b: n + 1 }))) return;
    const err = await writeOnce("preset.copy", n);
    await sleep(1500);
    return err ? t("presets.copyRefusedErr", { err }) : t("presets.presetCopiedB", { a: loaded! + 1, b: n + 1 });
  });
  const erase = (n: number) => run(t("presets.erasingPresetN", { n: n + 1 }), async () => {
    if (!confirm(t("presets.erasePresetNAll", { n: n + 1 }))) return;
    const err = await writeOnce("preset.erase", n);
    await sleep(1500);
    if (!err && n === loaded) await reload();
    return err ? t("presets.eraseRefusedErr", { err }) : t("presets.presetNErased", { n: n + 1 });
  });
  const startWith = (n: number) => run(t("presets.saving"), async () => {
    const err = await writeOnce("preset.select", n);
    if (!err) d.preset.select = n;
    return err ? t("presets.refusedErr", { err }) : t("presets.forgeNowStartsPreset", { n: n + 1 });
  });

  // --- file ---------------------------------------------------------------------------------
  function save() {
    const cfg = toCfg(d.identity.model, stateToEntries(d), [
      `Forge DSP ${d.identity.model}, Preset ${loaded !== null ? loaded + 1 : "?"}, ${new Date().toISOString().slice(0, 16)}`,
      `forge-dsp-gui-ng ${__APP_VERSION__} (${__APP_COMMIT__})`]);
    saveFile(cfg, `forge-${d.identity.model}-preset${loaded !== null ? loaded + 1 : ""}-${new Date().toISOString().slice(0, 10)}.cfg`, "text/plain");
  }

  let file = $state<{ name: string; model: string | null; entries: Entry[]; todo: Entry[]; refused: number } | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!f) return;
    const { model, entries } = parseCfg(await f.text());
    const ok = entries.filter(([r]) => restorable(r));
    file = { name: f.name, model, entries: ok, todo: entriesToWrite(ok, d), refused: entries.length - ok.length };
    note = "";
  }
  const modelFits = $derived(!file || !file.model || file.model === d.identity.model);
  const restore = () => run("Schreibe Abstimmung …", async () => {
    if (!file) return;
    let errors = 0;
    progress = { done: 0, total: file.todo.length };
    for (const [reg, value] of file.todo) {
      if (await writeRaw(reg, value)) errors++;
      progress.done++;
    }
    progress = null;
    const n = file.todo.length;
    file = null;
    await reload();
    return errors ? t("presets.okNValuesWritten", { ok: n - errors, n, bad: errors }) : t("presets.nValuesWritten", { n });
  });
</script>

<header class="head">
  <div>
    <h2>{t("common.presets")}</h2>
    <p class="muted">{t("presets.presetCompleteTuningDevice")}</p>
  </div>
</header>

{#if busy || note}
  <div class="panel msg" class:busy={!!busy} role="status">{busy || note}
    {#if progress}<progress value={progress.done} max={progress.total}></progress>{/if}</div>
{/if}

<div class="cards">
  {#each Array.from({ length: count }, (_, i) => i) as n}
    <section class="panel card" class:on={loaded === n}>
      <div class="cardhead">
        <span class="big num">{n + 1}</span>
        <div>
          <strong>Preset {n + 1}</strong>
          <span class="muted small">{loaded === n ? t("presets.loaded") : " "}{d.preset.select === n ? ` · ${t("presets.atStart")}` : ""}</span>
        </div>
      </div>
      <div class="btns">
        {#if loaded === n}
          <button disabled={!!busy || d.preset.select === n} onclick={() => startWith(n)}>{t("presets.loadAtStart")}</button>
        {:else}
          <button class="primary" disabled={!!busy} onclick={() => load(n)}>{t("common.load")}</button>
          <button disabled={!!busy || loaded === null} title={t("presets.copyLoadedPresetHere")} onclick={() => copy(n)}>{t("presets.copyHere")}</button>
        {/if}
        <button class="ghost danger" disabled={!!busy} onclick={() => erase(n)}>{t("presets.erase")}</button>
      </div>
    </section>
  {/each}
</div>

<section class="panel box">
  <h3>{t("presets.tuningAsFile")}</h3>
  <p class="muted">{t("presets.savesLoadedPresetMixer")}</p>
  <div class="btns">
    <button onclick={save} disabled={!!busy}>{t("presets.saveAsFile")}</button>
    <label class="filebtn" class:disabled={!!busy}>{t("presets.loadFile")}<input type="file" accept=".cfg,.txt" onchange={pick} disabled={!!busy} /></label>
  </div>
  {#if file}
    <div class="restore">
      <p><strong>{file.name}</strong>{#if file.model} {t("presets.for")} <span class="num">{file.model}</span>{/if}:
        {t("presets.nValuesMThem", { n: file.entries.length, m: file.todo.length })}
        {#if file.refused}<span class="warn">{t("presets.nLinesOtherCommands", { n: file.refused })}</span>{/if}</p>
      {#if !modelFits}
        <p class="warn">{t("presets.fileBConnectedIt", { a: file.model ?? "", b: d.identity.model })}</p>
      {:else if file.todo.length}
        <p class="muted">{t("presets.itWrittenIntoLoaded", { n: loaded !== null ? loaded + 1 : "" })}</p>
        <div class="btns">
          <button class="primary" disabled={!!busy} onclick={restore}>{t("presets.writeNValues", { n: file.todo.length })}</button>
          <button disabled={!!busy} onclick={() => (file = null)}>{t("common.cancel")}</button>
        </div>
      {:else}
        <p class="muted">{t("presets.deviceAlreadyHasExactly")}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .head { margin-bottom: 1rem; }
  .msg { padding: .6rem 1rem; margin-bottom: .75rem; display: grid; gap: .4rem; }
  .msg.busy { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  progress { width: 100%; accent-color: var(--accent); }
  .cards { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); margin-bottom: .75rem; }
  .card { padding: .9rem 1rem; display: grid; gap: .8rem; }
  .card.on { border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
  .cardhead { display: flex; align-items: center; gap: .8rem; }
  .cardhead div { display: grid; }
  .big { width: 2.6rem; height: 2.6rem; display: grid; place-items: center; border-radius: 10px; background: var(--raised); font-size: 1.3rem; font-weight: 650; }
  .card.on .big { background: var(--accent); color: var(--accent-ink); }
  .small { font-size: .8rem; min-height: 1.2em; display: block; }
  .btns { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  .danger { color: var(--err); margin-left: auto; }
  .box { padding: .9rem 1rem; display: grid; gap: .7rem; }
  .filebtn { padding: .42rem .85rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); cursor: pointer; }
  .filebtn.disabled { opacity: .45; cursor: default; }
  .filebtn input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .filebtn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .restore { border-top: 1px solid var(--line); padding-top: .7rem; display: grid; gap: .5rem; }
  .warn { color: var(--warn); }
</style>

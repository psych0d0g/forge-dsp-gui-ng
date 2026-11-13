<script lang="ts">
  import { t } from "../lib/i18n/index.svelte";
  import { explain } from "../lib/errors";
  import { saveFile } from "../lib/saveFile";
  import { app, withSd } from "../lib/app.svelte";
  import { isPort, sdDelete, sdDownload, sdList, sdNameFor, sdState, sdUpload, validSdName, type SdFile, type SdState } from "../lib/device";
  import Icon from "../components/Icon.svelte";

  // Files on the microSD in the Forge (port firmware, forge-dsp-firmware#59), transferred over the
  // serial line in blocks with a checksum. Slow (38400 Bd): fine for presets and logs.
  const port = $derived(isPort(app.device));
  let card = $state<SdState | null>(null);
  let files = $state<SdFile[]>([]);
  let busy = $state("");
  let done = $state(0);
  let total = $state(0);
  let error = $state("");
  let note = $state("");
  let loaded = $state(false);
  let pick = $state<{ file: File; name: string } | null>(null);

  const FAT = ["–", "FAT12", "FAT16", "FAT32"];
  const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fmtGb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

  async function run(what: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = what;
    error = "";
    note = "";
    done = total = 0;
    try {
      await fn();
    } catch (e) {
      error = explain(e);
    } finally {
      busy = "";
    }
  }

  const refresh = () =>
    run(t("sdcard.readingCard"), () =>
      withSd(async (l) => {
        const c = await sdState(l);
        files = c?.mounted ? await sdList(l) : [];
        card = c;
        loaded = true;
      }));

  $effect(() => {
    if (app.status === "online" && port && !loaded) refresh();
  });

  function save(data: Uint8Array, name: string) {
    saveFile(data.slice().buffer, name);
  }

  const download = (f: SdFile) =>
    run(t("sdcard.loadingName", { name: f.name }), () =>
      withSd(async (l) => {
        total = f.size;
        const t0 = performance.now();
        const data = await sdDownload(l, f.name, f.size, (n) => (done = n));
        save(data, f.name);
        note = `${f.name}: ${size(data.length)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      }));

  function picked(e: Event) {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = "";
    if (file) pick = { file, name: sdNameFor(file.name) };
  }

  const upload = () => {
    const p = pick;
    if (!p) return;
    run(t("sdcard.writingName", { name: p.name }), async () => {
      const data = new Uint8Array(await p.file.arrayBuffer());
      total = data.length;
      const exists = files.some((f) => f.name.toUpperCase() === p.name.toUpperCase());
      if (exists && !confirm(t("sdcard.nameAlreadyCardOverwrite", { name: p.name }))) return;
      await withSd(async (l) => {
        const t0 = performance.now();
        await sdUpload(l, p.name, data, (n) => (done = n));
        files = await sdList(l);
        note = t("sdcard.nameSizeWrittenS", { name: p.name, size: size(data.length), s: ((performance.now() - t0) / 1000).toFixed(1) })
          + (/^PRESET_\d\.CFG$/i.test(p.name) ? `, ${t("sdcard.loadedIntoPresetAt")}` : "");
      });
      pick = null;
    });
  };

  const remove = (f: SdFile) => {
    if (!confirm(t("sdcard.deleteNameFromCard", { name: f.name }))) return;
    run(t("sdcard.deletingName", { name: f.name }), () =>
      withSd(async (l) => {
        await sdDelete(l, f.name);
        files = await sdList(l);
      }));
  };

  // a full download of a few KB takes seconds: estimate from the line speed (about 300 B/s)
  const eta = (n: number) => (n > 3000 ? ` ${t("sdcard.aboutNS", { n: Math.ceil(n / 300) })}` : "");
</script>

<header class="head">
  <h2>{t("common.memoryCard")}</h2>
  <p class="muted">{t("sdcard.readWriteDeleteFiles")}</p>
</header>

{#if !port}
  <section class="panel box"><p class="muted">{t("sdcard.functionNeedsPortFirmware")}</p></section>
{:else}
  <section class="panel box">
    <div class="row">
      <div class="state">
        {#if !card}
          <span class="muted">{loaded ? t("sdcard.stateUnknown") : t("sdcard.notReadYet")}</span>
        {:else if !card.present}
          <span class="warn">{t("sdcard.noCardInserted")}</span>
        {:else if !card.mounted}
          <span class="warn">{t("sdcard.cardInsertedButNot")}</span>
        {:else}
          <span><strong>{FAT[card.fat] ?? "?"}</strong> · {fmtGb(card.mb)}{loaded ? ` · ${files.length === 1 ? t("sdcard.n1File") : t("sdcard.nFiles", { n: files.length })}` : ""}</span>
        {/if}
      </div>
      <div class="btns">
        <button onclick={refresh} disabled={!!busy}><Icon name="refresh" size={16} /> {t("sdcard.readAgain")}</button>
        <label class="filebtn" class:disabled={!!busy || !card?.mounted}>{t("sdcard.uploadFile")}<input type="file" onchange={picked}
          disabled={!!busy || !card?.mounted} /></label>
      </div>
    </div>

    {#if pick}
      <div class="upload">
        <span><strong>{pick.file.name}</strong> · {size(pick.file.size)}{eta(pick.file.size * 2.3)} {t("sdcard.as")}</span>
        <input class="name num" bind:value={pick.name} aria-label={t("sdcard.nameCard")} maxlength="12" />
        <button class="primary" onclick={upload} disabled={!!busy || !validSdName(pick.name)}
          title={validSdName(pick.name) ? "" : t("sdcard.n83NameAt")}>{t("sdcard.upload")}</button>
        <button onclick={() => (pick = null)} disabled={!!busy}>{t("common.cancel")}</button>
      </div>
    {/if}

    {#if busy}
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}>
        <span>{busy}{total ? ` ${t("sdcard.b", { a: size(done), b: size(total) })}` : ""}</span>
        {#if total}<div class="rail"><div class="fill" style="width:{(100 * done) / total}%"></div></div>{/if}
      </div>
    {/if}
    {#if error}<p class="err small">{error}</p>{/if}
    {#if note}<p class="ok small">{note}</p>{/if}

    {#if card?.mounted}
      {#if files.length}
        <table>
          <thead><tr><th>{t("common.file")}</th><th class="r">{t("common.size")}</th><th></th></tr></thead>
          <tbody>
            {#each files as f (f.name)}
              <tr>
                <td class="num">{f.name}</td>
                <td class="r num">{size(f.size)}</td>
                <td class="acts">
                  <button onclick={() => download(f)} disabled={!!busy} title="{t("common.download")}{eta(f.size)}">{t("common.download")}</button>
                  <button class="ghost danger" onclick={() => remove(f)} disabled={!!busy}>{t("sdcard.delete")}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if loaded}
        <p class="muted">{t("sdcard.noFilesRootDirectory")}</p>
      {/if}
    {/if}
  </section>
  <p class="muted small hint">{t("sdcard.forgeLoadsUploadedPRESET")}</p>
{/if}

<style>
  .head { margin-bottom: 1rem; }
  .box { padding: .9rem 1rem; display: grid; gap: .8rem; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .btns { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  .filebtn { padding: .42rem .85rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); cursor: pointer; }
  .filebtn.disabled { opacity: .45; cursor: default; pointer-events: none; }
  .filebtn input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .filebtn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .upload { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: .7rem; }
  .upload .name { width: 9rem; padding: .3rem .5rem; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--panel); color: var(--fg); font: inherit; }
  .progress { display: grid; gap: .3rem; font-size: .85rem; color: var(--accent); }
  .rail { height: 5px; border-radius: 3px; background: var(--line-strong); overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width .2s linear; }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: .76rem; padding: .3rem .4rem; border-bottom: 1px solid var(--line); }
  td { padding: .35rem .4rem; border-bottom: 1px solid var(--line); }
  .r { text-align: right; }
  .acts { text-align: right; white-space: nowrap; }
  .acts button { margin-left: .35rem; }
  .danger { color: var(--err); }
  .warn { color: var(--warn); }
  .err { color: var(--err); margin: 0; }
  .ok { color: var(--muted); margin: 0; }
  .small { font-size: .8rem; }
  .hint { margin-top: .6rem; }
  @media (max-width: 40rem) { .acts button { margin: .15rem 0 .15rem .3rem; } }
</style>

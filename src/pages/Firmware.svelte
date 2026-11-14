<script lang="ts">
  import { t, tx } from "../lib/i18n/index.svelte";
  import { explain } from "../lib/errors";
  import { saveFile } from "../lib/saveFile";
  import { app, bootReadDone, leaveBootloader, usbFast, usbSlow, query, reload, updateAccess, waitForBootloader, withSd, type BootWaitState } from "../lib/app.svelte";
  import { backupInfo, freeSlot, isPort, parseScan, sdBackup, sdList, sdState, type BackupInfo } from "../lib/device";
  import { describeFlash } from "../lib/boot/identify";
  import { isNative } from "../lib/native";
  import { openWebSerial } from "../lib/transport/webserial";
  import type { Transport } from "../lib/transport/types";
  import { APP_SIZE, imageKnows, runsPcb30 } from "../lib/boot/client";
  import { HexError, parseHex } from "../lib/boot/ihex";
  import { runUpdate, STEP_LABEL, UpdateError, type Step } from "../lib/boot/update";
  import { assetsFor, fetchAsset, loadReleases, type Release } from "../lib/boot/releases";

  const d = $derived(app.device);
  const id = $derived(d.identity);
  const boot = $derived(app.bootloader);
  // identity to keep after the update; in the bootloader the one from before or from the original image
  const identity = $derived(boot ? boot.identity : id.model && id.pcb ? `${id.model}-${id.pcb}` : "");
  const usb = $derived(!!updateAccess() && app.status === "online");
  const port = $derived(isPort(d));
  /** the original firmware runs: the update goes through the button and a new connection (#17) */
  const original = $derived(usb && !port && !boot && !app.demo);

  let file = $state<{ name: string; image: Uint8Array; sha: string } | null>(null);
  let fileError = $state("");
  let hasClock = $state<boolean | null>(null);
  let backup = $state(true);
  let understood = $state(false);
  let running = $state(false);
  let steps = $state<{ step: Step; done?: number; total?: number }[]>([]);
  let result = $state<{ ok: boolean; text: string; touched?: boolean; complete?: boolean } | null>(null);
  /** the backup of this update, kept until the page is left (offered as buttons as well) */
  let saved = $state<{ flash: Uint8Array; eeprom: Uint8Array; flashName: string; eepromName: string } | null>(null);
  let sdNote = $state("");

  $effect(() => {  // the clock generator tells PCB 3.0 from 4.x, both report "96ELN-4.0"
    if (port && app.status === "online" && hasClock === null && !running)
      query("i2c.1.scan").then((a) => { const s = parseScan(a[0]?.value); if (s.length) hasClock = s.includes(0xe0) || s.includes(0xe2); });
  });
  // in the bootloader the image in the flash tells it
  const clock = $derived(boot?.id ? boot.id.hasClock : hasClock);

  // backup on the card in the Forge (port firmware, forge-dsp-firmware#61), otherwise as files
  let sd = $state<{ info: BackupInfo; slot: number | null } | null>(null);
  let sdChecked = false;
  $effect(() => {
    if (!port || !usb || sdChecked || running) return;
    sdChecked = true;
    withSd(async (l) => {
      const st = await sdState(l);
      const info = st?.present && st.mounted ? await backupInfo(l) : null;
      return info ? { info, slot: freeSlot(await sdList(l)) } : null;
    }).then((r) => (sd = r)).catch(() => (sd = null));
  });
  const sdUsable = $derived(!!sd && sd.slot !== null);

  /** a .hex (from the PC or a release) as the image to write; the checks below apply to both */
  async function useHex(name: string, text: () => Promise<string>) {
    file = null; fileError = ""; result = null; understood = false;
    try {
      const image = parseHex(await text());
      if (!image.length) throw new HexError(t("firmware.fileContainsNoData"));
      if (image.length > APP_SIZE) throw new HexError(t("firmware.imageLargerThanApplication2"));
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", image as BufferSource));
      file = { name, image, sha: [...h].map((b) => b.toString(16).padStart(2, "0")).join("") };
    } catch (x) {
      fileError = x instanceof Error ? x.message : String(x);
    }
  }
  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (f) await useHex(f.name, () => f.text());
  }

  // --- releases next to the page (Pages build copies them from GitHub, #10) ---
  let releases = $state<Release[] | null>(null);
  let relTag = $state("");
  let relFile = $state("");
  let relBusy = $state(false);
  $effect(() => {  // once; a result after leaving the page is dropped
    let alive = true;
    loadReleases().then((r) => {
      if (!alive) return;
      releases = r?.length ? r : null;
      relTag = r?.find((x) => !x.prerelease)?.tag ?? r?.[0]?.tag ?? "";
    });
    return () => { alive = false; };
  });
  const rel = $derived(releases?.find((r) => r.tag === relTag) ?? null);
  const fitting = $derived(rel && id.model ? assetsFor(rel, id.model, id.pcb, clock) : []);
  const others = $derived(rel ? rel.assets.filter((a) => !fitting.includes(a)) : []);
  $effect(() => {  // propose the file of this device whenever the release or the device changes
    rel; fitting;
    relFile = fitting[0]?.file ?? "";
  });
  // in the bootloader: once the flash told the device, load the file of the newest release for it
  let autoLoaded = false;
  $effect(() => {
    if (!boot?.id || autoLoaded || file || relBusy || running || !rel || rel.original || !fitting.length || relFile !== fitting[0].file) return;
    autoLoaded = true;
    void loadRelease();
  });
  /** newest port release newer than what runs ("2.0.0-19-g…" counts as 2.0.0) */
  const newer = $derived.by(() => {
    const cur = /^(\d+)\.(\d+)\.(\d+)/.exec(id.port ?? "");
    const top = releases?.find((r) => !r.original && !r.prerelease);
    const t = top && /^v(\d+)\.(\d+)\.(\d+)$/.exec(top.tag);
    if (!cur || !t) return null;
    const a = cur.slice(1).map(Number), b = t.slice(1).map(Number);
    const cmp = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
    return cmp > 0 ? top : null;
  });
  async function loadRelease() {
    const a = rel?.assets.find((x) => x.file === relFile);
    if (!rel || !a) return;
    relBusy = true;
    await useHex(a.file, () => fetchAsset(rel, a));
    relBusy = false;
  }

  // checks before writing: [state, text]; "bad" blocks, "warn" needs the tick below
  const checks = $derived.by((): ["ok" | "warn" | "bad", string][] => {
    if (!file) return [];
    const c: ["ok" | "warn" | "bad", string][] = [];
    if (id.model && id.pcb) c.push(imageKnows(file.image, id.model, id.pcb)
      ? ["ok", t("firmware.imageKnowsDeviceId", { id: `${id.model}-${id.pcb}` })]
      : ["warn", t("firmware.modelModelPCBPcb", { model: id.model, pcb: id.pcb })]);
    else if (boot) c.push(["warn", t("firmware.modelUnknownNoKnown")]);
    const v30 = /V30/i.test(file.name), v4x = /V4[x01]/i.test(file.name);
    if (v4x && id.model === "96ELN" && runsPcb30(file.image))   // forge-dsp-firmware#69: one build for PCB 3.0 and 4.x
      c.push(["ok", t("firmware.runsBothBoards")]);
    else if (clock !== null && (v30 || v4x)) c.push(v30 === !clock
      ? ["ok", clock ? t("firmware.boardFitsFileName") : t("firmware.boardFitsFileName2")]
      : ["bad", clock ? t("firmware.fileNameSaysPCB")
        : t("firmware.fileNameSaysPCB2")]);
    else if (id.model === "96ELN") c.push(["warn", t("firmware.n96elnPCB30")]);
    if (/bascom|1\.11\.6000/i.test(file.name)) c.push(["warn", t("firmware.originalFirmwareItLater")]);
    return c;
  });
  const blocked = $derived(checks.some(([s]) => s === "bad"));
  const needsTick = $derived(checks.some(([s]) => s === "warn"));

  function download(data: Uint8Array, name: string) {
    saveFile(data as BlobPart, name);
  }

  // --- the way into the bootloader from the original firmware: switch off, hold the button, switch on ---
  let flow = $state<{ state: BootWaitState; ctl: { signal: AbortSignal; skipOff?: boolean; port?: () => Promise<Transport | null>;
    onState(s: BootWaitState): void }; abort: AbortController } | null>(null);
  let manual: Transport | null = null;
  async function pickPort() {   // browsers without getPorts: the user picks the port again
    manual = await openWebSerial().catch(() => null);
  }

  const day = () => new Date().toISOString().slice(0, 10);
  function step(s: Step, done?: number, total?: number) {
    const last = steps[steps.length - 1];
    if (last?.step === s) { last.done = done; last.total = total; } else steps.push({ step: s, done, total });
  }

  async function start() {
    if (!file || running || (!usb && !original)) return;
    const msg = original
      ? t("firmware.writeFirmwareNameForge", { name: file.name }) + "\n\n" + t("firmware.originalFirmwareCannotStart")
      : t("firmware.writeFirmwareNameForge2", { name: file.name }) + "\n\n" + t("firmware.musicStopsMeanwhileDo");
    if (!confirm(msg)) return;
    running = true; steps = []; result = null; saved = null; sdNote = "";
    const name = (what: string) => `forge-${identity || "unbekannt"}-${what}-${day()}.bin`;
    try {
      if (original) {
        step("power");
        const abort = new AbortController();
        flow = { state: "off", abort, ctl: { signal: abort.signal, port: async () => { const t = manual; manual = null; return t; },
          onState: (s) => { if (flow) flow.state = s; } } };
        const ok = await waitForBootloader(flow.ctl);
        flow = null;
        if (!ok) { result = { ok: false, text: t("firmware.cancelled") }; return; }
      }
      app.exclusive = true;
      if (app.bootloader) {
        step("read");
        while (app.bootloader?.read) { step("read", app.bootloader.read.done, app.bootloader.read.total); await new Promise((r) => setTimeout(r, 300)); }
        await bootReadDone();
        const b = app.bootloader;
        if (!b?.flash || !b.eeprom) throw new UpdateError(`${t("firmware.reading")}: ${b?.error || t("common.notConnected")}`, "read", false);
        step("read", 1, 1);
        saved = { flash: b.flash, eeprom: b.eeprom, flashName: name("flash"), eepromName: name("eeprom") };
        download(b.flash, saved.flashName);  // the browser may block downloads that no click started: buttons below
        download(b.eeprom, saved.eepromName);
      }
      let onCard = false;
      if (backup && port && sd && sdUsable) {
        step("sdbackup", 0, 1);
        app.exclusive = false;   // withSd takes the port itself
        try {
          const r = await withSd((l) => sdBackup(l, sd!.info, (i, parts) => step("sdbackup", i, parts.length)));
          onCard = true;
          sdNote = t("firmware.savedMemoryCardForge", { slot: r.slot, files: r.parts.map((p) => p.file).join(", ") });
        } catch (e) {
          sdNote = t("firmware.backupCardFailedErr", { err: explain(e) });
        }
        app.exclusive = true;
      }
      await usbSlow();   // the bootloader measures the rate at 38400 (forge-dsp-firmware#62)
      const io = updateAccess();
      if (!io) throw new Error(t("common.notConnected"));
      const r = await runUpdate({ ...io,
        onStep: step,
        onBackup: (flash, eeprom) => {
          saved = { flash, eeprom, flashName: name("flash"), eepromName: name("eeprom") };
          download(flash, saved.flashName);
          download(eeprom, saved.eepromName);
        },
      }, { image: file.image, backup: backup && !onCard && !app.bootloader, identity });
      result = { ok: true, text: t("firmware.doneNBytesWritten", { n: r.written }) };
      app.exclusive = false;
      sdChecked = false; sd = null;
      await reload();
      await usbFast();
    } catch (e) {
      const u = e instanceof UpdateError ? e : null;
      result = { ok: false, text: u ? `${tx(STEP_LABEL[u.step])}: ${explain(u.message)}` : explain(e), touched: u?.flashTouched, complete: u?.complete };
    } finally {
      flow = null;
      running = false; app.exclusive = false;
    }
  }
  const pct = (s: { done?: number; total?: number }) => (s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null);
</script>

<header class="head">
  <div>
    <h2>{t("common.firmware")}</h2>
    <p class="muted">{t("firmware.updateFirmwareForgeTuning")}</p>
  </div>
</header>

<div class="cols">
  <section class="panel box">
    <h3>{t("firmware.device")}</h3>
    <dl>
      <dt>{t("common.model")}</dt><dd>{id.model || "–"} <span class="muted">PCB {id.pcb || "–"}</span></dd>
      {#if boot}
        <dt>{t("common.state")}</dt><dd>{t("firmware.bootloaderV", { v: boot.version })}</dd>
        <dt>{t("firmware.flash")}</dt><dd>{#if boot.read}{t("firmware.reading2")} <span class="num muted">{Math.round((100 * boot.read.done) / boot.read.total)} %</span>
          {:else if boot.id}{describeFlash(boot.id)}{:else}<span class="bad">{boot.error || "–"}</span>{/if}</dd>
      {:else}
        <dt>Firmware</dt><dd class="num">{id.port ? `Port ${id.port}` : id.firmware ? `${t("firmware.original")} ${id.firmware}` : "–"}</dd>
      {/if}
      {#if clock !== null}<dt>{t("common.clockGenerator")}</dt><dd>{clock ? t("firmware.presentPCB4X") : t("firmware.notPresentPCB3")}</dd>{/if}
    </dl>
    {#if boot}
      {#if boot.read}<progress value={boot.read.done} max={boot.read.total}></progress>{/if}
      <p class="muted small">{t("firmware.forgeWaitsBootloaderFirmware")}</p>
      <div class="btns">
        {#if boot.flash && boot.eeprom}
          <button onclick={() => download(boot.flash!, `forge-${identity || "unbekannt"}-flash-${day()}.bin`)}>{t("firmware.saveFlash")}</button>
          <button onclick={() => download(boot.eeprom!, `forge-${identity || "unbekannt"}-eeprom-${day()}.bin`)}>{t("firmware.saveEEPROM")}</button>
        {/if}
        <button disabled={running || !!boot.read} onclick={leaveBootloader}>{t("firmware.startFirmwareFlash")}</button>
      </div>
    {/if}
    <p class="muted small">{t("firmware.firmwareFilesHexAt")}
      <a href="https://github.com/psych0d0g/forge-dsp-firmware/releases" target="_blank" rel="noreferrer">forge-dsp-firmware/releases</a>.
      {t("firmware.itAlsoSaysWhich")}</p>
  </section>

  <section class="panel box">
    <h3>{t("firmware.update")}</h3>
    {#if flow}
      <div class="flow" role="status">
        {#if flow.state === "off"}
          <p><strong>{t("firmware.n1SwitchForgeOff")}</strong> {t("firmware.ignitionOrRemoteOff")}</p>
          <div class="btns"><button onclick={() => (flow!.ctl.skipOff = true)}>{t("firmware.portStaysContinue")}</button></div>
        {:else}
          <p><strong>{t("firmware.n2HoldButtonNext")}</strong> {t("firmware.keepHoldingButtonUntil")}</p>
          {#if flow.state === "noBoot"}
            <p class="warnt">{t("firmware.forgeThereButBootloader")}</p>
          {:else if flow.state === "found"}<p class="ok">{t("firmware.bootloaderConnected")}</p>{/if}
          {#if !isNative()}<p class="muted small">{t("firmware.ifPageDoesNot")}
            <button class="linkish" onclick={pickPort}>{t("common.choosePort")}</button></p>{/if}
        {/if}
        <div class="btns"><button class="ghost" onclick={() => flow?.abort.abort()}>{t("common.cancel")}</button></div>
      </div>
    {:else if app.target !== 1}
      <p class="muted">{t("firmware.onlyFirstDevice")}</p>
    {:else if !usb}
      <p class="muted">{t("firmware.updateWorksOnlyOver")}</p>
    {:else}
      <p class="muted" hidden={!original}>{t("firmware.deviceRunsOriginalFirmware")}</p>
      <div class="relwrap">
      {#if releases}
        <div class="rel">
          {#if newer}<p class="new">{t("firmware.newVersionAvailable")} <strong>{newer.name}</strong> ({newer.date}).</p>{/if}
          <div class="relrow">
            <label>{t("firmware.release")}
              <select bind:value={relTag} disabled={running || relBusy}>
                {#each releases as r}<option value={r.tag}>{r.name}{r.original ? ` (${t("firmware.original")})` : ""} · {r.date}</option>{/each}
              </select>
            </label>
            <label>{t("common.file")}
              <select bind:value={relFile} disabled={running || relBusy}>
                {#if fitting.length}<optgroup label={t("firmware.fitsDevice")}>{#each fitting as a}<option value={a.file}>{a.file}</option>{/each}</optgroup>{/if}
                {#if others.length}<optgroup label={t("firmware.otherDevices")}>{#each others as a}<option value={a.file}>{a.file}</option>{/each}</optgroup>{/if}
              </select>
            </label>
            <button onclick={loadRelease} disabled={running || relBusy || !relFile}>{relBusy ? t("firmware.loading") : t("common.load")}</button>
          </div>
          {#if rel}<p class="muted small"><a href={rel.url} target="_blank" rel="noreferrer">{t("firmware.releaseNotes")}</a> · {t("firmware.loadedFromPageChecked")}</p>{/if}
        </div>
        <p class="muted small or">{t("firmware.orFileFromComputer")}</p>
      {/if}
      </div>
      <label class="filebtn" class:disabled={running}>{t("firmware.chooseFirmwareFile")}<input type="file" accept=".hex" onchange={pick} disabled={running} /></label>
      {#if fileError}<p class="bad">{fileError}</p>{/if}
      {#if file}
        <dl>
          <dt>{t("common.file")}</dt><dd>{file.name}</dd>
          <dt>{t("common.size")}</dt><dd class="num">{file.image.length} Bytes</dd>
          <dt>SHA-256</dt><dd class="num sha" title={t("firmware.compareSHA256SUMSRelease")}>{file.sha}</dd>
        </dl>
        <ul class="checks">{#each checks as [s, text]}<li class={s}>{text}</li>{/each}</ul>
        {#if boot}
          <p class="muted small">{boot.flash ? t("firmware.backupFlashEEPROMWere") : t("firmware.backupFlashEEPROMBeing")}</p>
        {:else if original}
          <p class="muted small">{t("firmware.backupBootloaderReadsFlash")}</p>
        {:else}
          <label class="check"><input type="checkbox" bind:checked={backup} disabled={running} /> {t("firmware.backUpFirst")}
            {#if sdUsable}{t("firmware.memoryCardForgeSlot", { n: sd!.slot ?? "" })}
            {:else}{t("firmware.oldFirmwareSettingsAs")}{#if sd && sd.slot === null} – {t("firmware.cardAlreadyHolds9")}{/if}{/if}</label>
        {/if}
        {#if needsTick && !blocked}
          <label class="check"><input type="checkbox" bind:checked={understood} disabled={running} /> {t("firmware.notesReadImageRight")}</label>
        {/if}
        <div><button class="primary" disabled={running || blocked || (needsTick && !understood) || !!boot?.read} onclick={start}>{t("firmware.startUpdate")}</button></div>
      {/if}
    {/if}

    {#if steps.length}
      <ol class="steps">
        {#each steps as s, i}
          <li class:now={running && i === steps.length - 1}>
            <span>{tx(STEP_LABEL[s.step])}</span>
            {#if pct(s) !== null}<progress value={s.done} max={s.total}></progress><span class="num muted">{pct(s)} %</span>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if sdNote}<p class="small">{sdNote}</p>{/if}
    {#if saved}
      <div class="saved">
        <span class="muted small">{t("firmware.backupBeforeUpdateN", { n: saved.flash.length + saved.eeprom.length })}</span>
        <div class="btns">
          <button onclick={() => download(saved!.flash, saved!.flashName)}>{t("firmware.saveFlashBackup")}</button>
          <button onclick={() => download(saved!.eeprom, saved!.eepromName)}>{t("firmware.saveEEPROMBackup")}</button>
        </div>
      </div>
    {/if}
    {#if result}
      <div class="result" class:ok={result.ok} class:bad={!result.ok} role="status">
        <p>{result.text}</p>
        {#if result.complete}
          <p>{t("firmware.completeButStep")}</p>
        {:else if result.touched}
          <p>{t("firmware.oldFirmwareNoLonger")}</p>
        {:else if !result.ok}
          <p>{t("firmware.nothingWasChangedDevice")}</p>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .head { margin-bottom: 1rem; }
  .cols { display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); align-items: start; }
  .box { padding: .9rem 1rem; display: grid; gap: .7rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.25rem; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .sha { font-size: .75rem; }
  .small { font-size: .8rem; }
  a { color: var(--accent); }
  .filebtn { justify-self: start; padding: .42rem .85rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); cursor: pointer; }
  .filebtn.disabled { opacity: .45; cursor: default; }
  .filebtn input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .filebtn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .relwrap { display: grid; gap: .45rem; }
  .relwrap:empty { display: none; }
  .rel { display: grid; gap: .45rem; }
  .relrow { display: flex; gap: .6rem; align-items: flex-end; flex-wrap: wrap; }
  .relrow label { display: grid; gap: .2rem; font-size: .8rem; color: var(--muted); min-width: 0; }
  .relrow select { font: inherit; font-size: .88rem; padding: .3rem .45rem; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--fg); max-width: 100%; }
  .new { margin: 0; color: var(--accent); }
  .or { margin: .2rem 0 0; }
  .checks { margin: 0; padding: 0; list-style: none; display: grid; gap: .3rem; }
  .checks li { padding-left: 1.1rem; position: relative; }
  .checks li::before { content: ""; position: absolute; left: 0; top: .5em; width: .55rem; height: .55rem; border-radius: 50%; background: var(--ok); }
  .checks .warn::before { background: var(--warn); }
  .checks .bad::before { background: var(--err); }
  .checks .bad, .bad { color: var(--err); }
  .check { display: flex; align-items: baseline; gap: .45rem; }
  .check input { accent-color: var(--accent); }
  .steps { margin: 0; padding-left: 1.3rem; display: grid; gap: .3rem; border-top: 1px solid var(--line); padding-top: .7rem; }
  .steps li { color: var(--muted); }
  .steps li.now { color: var(--fg); }
  .steps progress { width: 9rem; margin: 0 .5rem; accent-color: var(--accent); vertical-align: middle; }
  .btns { display: flex; gap: .5rem; flex-wrap: wrap; }
  .flow { display: grid; gap: .5rem; border: 1px solid var(--accent); border-radius: 10px; padding: .7rem .85rem; }
  .flow p { margin: 0; }
  .warnt { color: var(--warn); }
  .ok { color: var(--ok); }
  .linkish { padding: .1rem .45rem; font-size: .8rem; }
  .saved { display: grid; gap: .35rem; border-top: 1px solid var(--line); padding-top: .6rem; }
  .saved .btns { display: flex; gap: .5rem; flex-wrap: wrap; }
  .result { border: 1px solid var(--line-strong); border-radius: 10px; padding: .6rem .8rem; display: grid; gap: .3rem; }
  .result.ok { border-color: var(--ok); color: var(--ok); }
  .result.bad { border-color: var(--err); }
  @media (max-width: 60rem) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>

<script lang="ts">
  import { t, tx } from "../lib/i18n/index.svelte";
  import { explain } from "../lib/errors";
  import { saveFile } from "../lib/saveFile";
  import { app, query, withSd, writeOnce } from "../lib/app.svelte";
  import { chipAt, ct7302Locked, decodeLog, exportState, errorName, es9018Locked, hardwareCheck, hex2, isEeprom, isPort, LOG_FILE, LOG_FILE_BIT,
    LOG_LEVELS, LOG_OLD, logModule, logText, parseDspBoot, parseRegister, parseScan, sdDelete, sdDownload, sdList,
    type LogRecord } from "../lib/device";
  import Icon from "../components/Icon.svelte";

  const d = $derived(app.device);
  const port = $derived(isPort(d));
  const hw = $derived(hardwareCheck(d.features.hw));

  let busy = $state(false);
  let scans = $state<Record<number, number[]>>({});
  let rx = $state<number | null>(null);      // CT7302 0x7A
  let dac = $state<number | null>(null);     // ES9018 27
  let boot = $state<ReturnType<typeof parseDspBoot>>(null);
  let checked = $state("");

  const supply = $derived(Array.isArray(d.supply) ? d.supply.map(Number) : null);
  const found = (bus: number, addr: number) => scans[bus]?.includes(addr);

  async function refresh() {
    if (busy) return;
    busy = true;
    if (port) await readLogSettings();
    await query("system.feature.attributes.hw");
    await query("system.errors");
    await query("system.temperature.celsius");
    if (port) {
      await query("system.supply");
      for (const bus of [1, 2]) scans[bus] = parseScan((await query(`i2c.${bus}.scan`))[0]?.value);
      rx = found(1, 0x20) ? parseRegister((await query("i2c.1.32.122"))[0]?.value) : null;
      dac = found(2, 0x90) ? parseRegister((await query("i2c.2.144.27"))[0]?.value) : null;
      boot = parseDspBoot((await query("system.hardware.dsp"))[0]?.value);
    }
    checked = new Date().toLocaleTimeString();
    busy = false;
  }
  $effect(() => {
    if (app.status === "online" && !checked) refresh();
  });

  // --- binary log on the microSD (forge-dsp-firmware#60): switched by system.debug.out bit 2 and
  // the level system.debug.mode, both stored in the Forge ------------------------------------------
  let dbgOut = $state<number | null>(null);
  let dbgMode = $state<number | null>(null);
  let logBusy = $state("");
  let logError = $state("");
  let logRecs = $state<LogRecord[] | null>(null);
  let logSize = $state(0);
  let logShow = $state(60);
  const num = (r: Awaited<ReturnType<typeof query>>) => {
    const v = r.find((a) => a.kind === "get")?.value;
    return v === undefined ? null : Number(v);
  };
  async function readLogSettings() {
    dbgOut = num(await query("system.debug.out"));
    dbgMode = num(await query("system.debug.mode"));
  }
  const logOn = $derived(dbgOut !== null && (dbgOut & LOG_FILE_BIT) !== 0 && (dbgMode ?? 0) > 0);
  async function setLog(on: boolean, level = dbgMode || 4) {
    if (dbgOut === null) return;
    logError = (await writeOnce("system.debug.out", on ? dbgOut | LOG_FILE_BIT : dbgOut & ~LOG_FILE_BIT))
      || (on ? await writeOnce("system.debug.mode", level) : "");
    await readLogSettings();
  }
  async function logRun(what: string, fn: () => Promise<void>) {
    if (logBusy) return;
    logBusy = what;
    logError = "";
    try { await fn(); } catch (e) { logError = explain(e); } finally { logBusy = ""; }
  }
  /** FORGE.OLD first, then FORGE.LOG: oldest to newest */
  async function fetchLog(): Promise<Uint8Array> {
    return withSd(async (l) => {
      const files = await sdList(l);
      const parts: Uint8Array[] = [];
      for (const n of [LOG_OLD, LOG_FILE]) {
        const f = files.find((x) => x.name === n);
        if (f) parts.push(await sdDownload(l, n, f.size, (k) => (logBusy = t("diagnose.readingNameKN", { name: n, k, n: f.size }))));
      }
      const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return all;
    });
  }
  const readLog = () => logRun(t("diagnose.readingLog"), async () => {
    const b = await fetchLog();
    logSize = b.length;
    logRecs = decodeLog(b).reverse();
  });
  const saveLog = () => logRun(t("diagnose.readingLog"), async () => {
    const b = await fetchLog();
    saveFile(b.slice().buffer, `forge-log-${new Date().toISOString().slice(0, 10)}.bin`);
  });
  const clearLog = () => {
    if (!confirm(t("diagnose.deleteLogCardFORGE"))) return;
    logRun(t("diagnose.deletingLog"), () => withSd(async (l) => {
      const files = (await sdList(l)).map((f) => f.name);
      for (const n of [LOG_FILE, LOG_OLD]) if (files.includes(n)) await sdDelete(l, n);
      logRecs = [];
      logSize = 0;
    }));
  };
  const ms = (v: number) => (v < 60000 ? `${(v / 1000).toFixed(1)} s` : `${Math.floor(v / 60000)} min ${Math.round((v % 60000) / 1000)} s`);
  const LEVEL_CLASS = ["", "bad", "bad", "warnl", "", "muted", "muted", "muted"];

  /** the whole model as read from the device (#2) */
  function saveState() {
    saveFile(exportState(app.device), `forge-zustand-${d.identity.model || "gerät"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, "application/json");
  }

  // port extension: set system.errors=0 empties the counters (the original only by a factory reset)
  let clearError = $state("");
  async function clearErrors() {
    if (busy || !confirm(t("diagnose.resetAllErrorCounters"))) return;
    busy = true;
    clearError = await writeOnce("system.errors", 0);
    await query("system.errors");
    busy = false;
  }

  // register access
  let rBus = $state(1), rAddr = $state("20"), rReg = $state("7A"), rVal = $state(""), rOut = $state(""), expert = $state(false);
  const h = (t: string) => parseInt(t, 16);
  const rOk = $derived(!Number.isNaN(h(rAddr)) && !Number.isNaN(h(rReg)) && h(rAddr) <= 0xfe && h(rReg) <= 0xff);
  async function readReg() {
    const a = (await query(`i2c.${rBus}.${h(rAddr)}.${h(rReg)}`))[0];
    const v = parseRegister(a?.value);
    rOut = v === null ? t("common.noAnswer") + (a?.message ? ` (${a.message})` : "") : `0x${hex2(v)} = ${v} = ${v.toString(2).padStart(8, "0")}b`;
  }
  async function writeReg() {
    const v = h(rVal);
    if (Number.isNaN(v) || v > 0xff) { rOut = t("diagnose.valueTwoHexDigits"); return; }
    if (!confirm(t("diagnose.setRegister0xReg", { reg: hex2(h(rReg)), chip: hex2(h(rAddr)), bus: rBus, v: hex2(v) })
      + "\n\n" + t("diagnose.wrongValueCanDisturb"))) return;
    const err = await writeOnce(`i2c.${rBus}.${h(rAddr)}.${h(rReg)}`, v);
    rOut = err ? t("diagnose.refusedErr", { err }) : t("diagnose.written");
    if (!err) await readReg();
  }

  function report(): string {
    const id = d.identity, L: string[] = [];
    L.push(t("diagnose.forgeDSPDiagnosticReport", { date: new Date().toISOString() }), `GUI ${__APP_VERSION__} (${__APP_COMMIT__})`, "");
    L.push(`${t("common.model")}: ${id.model} PCB ${id.pcb}`, `Firmware: ${id.port ? `Port ${id.port} (${t("common.protocolV", { v: id.firmware })})` : id.firmware}`,
      `${t("common.sampleRate")}: ${id.sampleRate}`, `${t("diagnose.connection")}: ${app.transportName}`, "");
    if (hw) L.push(`${t("diagnose.hardwareCheck")}: ${hw.ok ? "ok" : t("diagnose.mismatch")} (${t("diagnose.dspExpectedFoundB", { a: hw.dsp[0], b: hw.dsp[1], c: hw.other[0], d: hw.other[1] })})`);
    L.push(`${t("common.temperature")}: ${d.temperature?.toFixed(1) ?? "-"} °C`);
    if (supply) L.push(`3,3 V: ${supply[0]} mV, ${t("diagnose.supplyVoltage")}: ${supply[1] >= 0 ? supply[1] + " mV" : t("diagnose.notSetUp")}`);
    if (rx !== null) L.push(`CT7302 0x7A: 0x${hex2(rx)} (${ct7302Locked(rx) ? t("diagnose.locked") : t("common.noSignal")})`);
    if (dac !== null) L.push(`ES9018 Reg. 27: 0x${hex2(dac)} (${es9018Locked(dac) ? t("diagnose.locked") : t("diagnose.notLocked")})`);
    if (boot) for (const b of boot.buses) L.push(t("diagnose.dspStartBusBus",
      { bus: b.bus, start: b.startMs, edges: b.edges, quiet: b.quietMs, limit: b.timeout ? t("diagnose.reached") : t("diagnose.no"), retries: b.retries }));
    if (boot?.restarted) L.push(t("diagnose.startFollowedRestartBecause"));
    L.push("", `${t("common.errorCounters")}:`);
    L.push(...(d.errors.length ? d.errors.map(([c, n]) => `  ${c}: ${n}x  ${errorName(c)}`) : [`  ${t("common.none")}`]));
    for (const bus of [1, 2]) if (scans[bus]) L.push("", `${t("diagnose.i2cBusN", { n: bus })}:`, ...scans[bus].map((a) => `  0x${hex2(a)}  ${chipAt(bus, a)?.name ?? t("common.unknown")}  ${chipAt(bus, a) ? tx(chipAt(bus, a)!.role) : ""}`));
    return L.join("\n") + "\n";  // without the serial number: reports get attached to public issues
  }
  function download() {
    saveFile(report(), `forge-diagnose-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain");
  }
</script>

<header class="head">
  <div>
    <h2>{t("common.diagnostics")}</h2>
    <p class="muted">{t("diagnose.stateChipsForge")} {#if checked}{t("diagnose.asTime", { time: checked })}{/if}</p>
  </div>
  <div class="acts">
    <button onclick={refresh} disabled={busy}><Icon name="refresh" size={16} /> {busy ? t("diagnose.checking") : t("diagnose.checkAgain")}</button>
    <button onclick={download} disabled={!checked}>{t("diagnose.saveReport")}</button>
    <button onclick={saveState} disabled={app.status !== "online"}
      title={t("diagnose.everythingInterfaceHasRead")}>{t("diagnose.saveState")}</button>
  </div>
</header>

<div class="tiles">
  <section class="panel tile">
    <h3>{t("common.device")}</h3>
    <dl>
      <dt>{t("diagnose.hardwareCheck")}</dt>
      <dd>{#if hw}<span class="state" class:ok={hw.ok} class:bad={!hw.ok}>{hw.ok ? t("diagnose.allChipsFound") : t("diagnose.chipsMissingOutputsMuted")}</span>{:else}–{/if}</dd>
      <dt>{t("common.temperature")}</dt><dd class="num">{d.temperature !== null ? `${d.temperature.toFixed(1)} °C` : "–"}</dd>
      {#if supply}
        <dt>{t("diagnose.n33VRail")}</dt><dd class="num">{(supply[0] / 1000).toFixed(2)} V</dd>
        <dt>{t("diagnose.supplyVoltage")}</dt><dd class="num">{supply[1] >= 0 ? `${(supply[1] / 1000).toFixed(2)} V` : t("diagnose.notSetUp")}</dd>
      {/if}
    </dl>
  </section>
  <section class="panel tile">
    <h3>{t("diagnose.signal")}</h3>
    {#if port}
      <dl>
        <dt>{t("diagnose.sPDIFReceiver")}</dt>
        <dd>{#if rx !== null}<span class="state" class:ok={ct7302Locked(rx)}>{ct7302Locked(rx) ? t("diagnose.locked") : t("common.noSignal")}</span>
          <span class="muted num">0x{hex2(rx)}</span>{:else}–{/if}</dd>
        <dt>{t("diagnose.daConverter")}</dt>
        <dd>{#if dac !== null}<span class="state" class:ok={es9018Locked(dac)}>{es9018Locked(dac) ? t("diagnose.locked") : t("diagnose.waitingClock")}</span>
          <span class="muted num">0x{hex2(dac)}</span>{:else if scans[2]}<span class="muted">{t("diagnose.noES9018Bus2")}</span>{:else}–{/if}</dd>
        {#if boot}
          {#each boot.buses as b}
            <dt>{t("diagnose.dspStartBusN", { n: b.bus })}</dt>
            <dd class="num">{b.quietMs} ms{#if b.retries}, {t("diagnose.nRetries", { n: b.retries })}{/if}{#if b.timeout}<span class="state bad"> {t("diagnose.timeLimit")}</span>{/if}</dd>
          {/each}
          {#if boot.restarted}<dt>{t("diagnose.restart")}</dt><dd><span class="state bad">{t("diagnose.afterMissingDSPCores")}</span></dd>{/if}
        {/if}
      </dl>
    {:else}
      <p class="muted">{t("diagnose.directLookAtChips")}</p>
    {/if}
  </section>
  <section class="panel tile">
    <div class="tilehead">
      <h3>{t("common.errorCounters")}</h3>
      {#if port && d.errors.length}
        <button class="ghost small" onclick={clearErrors} disabled={busy}
          title={t("diagnose.setAllErrorCounters")}>{t("diagnose.reset")}</button>
      {/if}
    </div>
    {#if clearError}<p class="err small">{clearError}</p>{/if}
    {#if d.errors.length}
      <table class="errs"><tbody>
        {#each d.errors as [code, n]}<tr><td class="num">{n}×</td><td>{errorName(code)}</td><td class="muted num">{code}</td></tr>{/each}
      </tbody></table>
      <p class="muted small">{t("diagnose.countedSinceLastReset")}</p>
    {:else}<p class="muted">{t("diagnose.noEntries")}</p>{/if}
  </section>
</div>

{#if port}
  <div class="tiles two">
    {#each [1, 2] as bus}
      <section class="panel tile">
        <h3>{t("diagnose.i2cBusN", { n: bus })}</h3>
        {#if scans[bus]}
          <table class="chips"><tbody>
            {#each scans[bus] as a}
              {@const c = chipAt(bus, a)}
              <tr><td class="num">0x{hex2(a)}</td><td>{c?.name ?? t("common.unknown")}</td><td class="muted">{c ? tx(c.role) : ""}</td></tr>
            {/each}
          </tbody></table>
        {:else}<p class="muted">{t("diagnose.notCheckedYet")}</p>{/if}
      </section>
    {/each}
  </div>

  <section class="panel tile reg">
    <h3>{t("diagnose.register")}</h3>
    <div class="regrow">
      <label>{t("diagnose.bus")} <select bind:value={rBus}><option value={1}>1</option><option value={2}>2</option></select></label>
      <label>{t("diagnose.chip")} 0x<input class="num hx" bind:value={rAddr} maxlength="2" spellcheck="false" /></label>
      <label>{t("diagnose.register")} 0x<input class="num hx" bind:value={rReg} maxlength="2" spellcheck="false" /></label>
      <button onclick={readReg} disabled={!rOk || isEeprom(h(rAddr))}>{t("diagnose.read")}</button>
      {#if expert}
        <label>{t("common.value")} 0x<input class="num hx" bind:value={rVal} maxlength="2" spellcheck="false" /></label>
        <button onclick={writeReg} disabled={!rOk || isEeprom(h(rAddr))}>{t("diagnose.write")}</button>
      {/if}
      <span class="num out">{rOut}</span>
    </div>
    <label class="check"><input type="checkbox" bind:checked={expert} /> {t("diagnose.allowWritingExpertMode")}</label>
    {#if isEeprom(h(rAddr))}<p class="muted small">{t("diagnose.firmwareDoesNotAllow")}</p>{/if}
  </section>

  <section class="panel tile log">
    <div class="tilehead">
      <h3>{t("diagnose.logMemoryCard")}</h3>
      <div class="acts">
        <button onclick={readLog} disabled={!!logBusy}>{t("diagnose.read")}</button>
        <button onclick={saveLog} disabled={!!logBusy}>{t("common.download")}</button>
        <button class="ghost danger" onclick={clearLog} disabled={!!logBusy}>{t("diagnose.delete")}</button>
      </div>
    </div>
    <div class="logset">
      <label class="check"><input type="checkbox" checked={logOn} disabled={dbgOut === null || !!logBusy}
        onchange={(e) => setLog((e.target as HTMLInputElement).checked)} /> {t("diagnose.writeEventsCard")}</label>
      <label class="check">{t("diagnose.level")}
        <select value={dbgMode || 4} disabled={!logOn || !!logBusy}
          onchange={(e) => setLog(true, Number((e.target as HTMLSelectElement).value))}>
          {#each LOG_LEVELS as lv, i}{#if i > 0 && i < 7}<option value={i}>{i} {tx(lv)}</option>{/if}{/each}
        </select>
      </label>
      <span class="muted small">{t("diagnose.storedForgeSystemDebug")}</span>
    </div>
    {#if logBusy}<p class="busytext small">{logBusy}</p>{/if}
    {#if logError}<p class="err small">{logError}</p>{/if}
    {#if logRecs}
      {#if logRecs.length}
        <p class="muted small">{t("diagnose.nEntriesSizeBytes", { n: logRecs.length, size: logSize })}</p>
        <table class="logt">
          <thead><tr><th>{t("common.start")}</th><th>{t("diagnose.time")}</th><th>{t("diagnose.level")}</th><th>{t("diagnose.area")}</th><th>{t("common.event")}</th></tr></thead>
          <tbody>
            {#each logRecs.slice(0, logShow) as r, i (i)}
              <tr class:first={r.module === 1 && r.event === 1}>
                <td class="num">{r.boot}</td><td class="num">{ms(r.ms)}</td>
                <td class={LEVEL_CLASS[r.level] ?? ""}>{LOG_LEVELS[r.level] ? tx(LOG_LEVELS[r.level]) : r.level}</td>
                <td>{logModule(r.module)}</td><td>{logText(r)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if logRecs.length > logShow}<button class="ghost" onclick={() => (logShow += 200)}>{t("diagnose.showOlder")}</button>{/if}
      {:else}<p class="muted">{t("diagnose.noLogCard")}</p>{/if}
    {/if}
  </section>
{/if}

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .acts { display: flex; gap: .5rem; flex-wrap: wrap; }
  .acts button { display: inline-flex; align-items: center; gap: .4rem; }
  .tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); margin-bottom: .75rem; align-items: start; }
  .tile { padding: .9rem 1rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: .6rem; align-content: start; }
  .tilehead { display: flex; justify-content: space-between; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .tilehead h3 { margin: 0; }
  .err { color: var(--err); margin: 0; }
  .log { margin-top: .75rem; }
  .logset { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .logset select { font: inherit; padding: .2rem .35rem; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--fg); }
  .logt { font-size: .82rem; }
  .logt th { text-align: left; color: var(--muted); font-weight: 600; font-size: .74rem; padding: .25rem .4rem; border-bottom: 1px solid var(--line); }
  .logt td { padding: .22rem .4rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  .logt tr.first td { border-top: 2px solid var(--line-strong); }
  .logt .bad { color: var(--err); }
  .logt .warnl { color: var(--warn); }
  .busytext { color: var(--accent); margin: 0; }
  .danger { color: var(--err); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1.25rem; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .state { color: var(--muted); }
  .state.ok { color: var(--ok); }
  .state.bad { color: var(--err); }
  table { border-collapse: collapse; width: 100%; }
  td { padding: .2rem .9rem .2rem 0; vertical-align: top; }
  .errs td:first-child { width: 3rem; }
  .errs td:last-child, .chips td:first-child { white-space: nowrap; }
  .small { font-size: .8rem; }
  .regrow { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .regrow label { display: inline-flex; align-items: baseline; gap: .3rem; color: var(--muted); }
  .hx { width: 2.8rem; text-transform: uppercase; }
  select { padding: .35rem .5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); }
  select option { background: var(--bg); }
  .out { color: var(--fg); }
  .check { display: inline-flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; }
  .check input { accent-color: var(--accent); }
</style>

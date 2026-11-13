<script lang="ts">
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
        if (f) parts.push(await sdDownload(l, n, f.size, (k) => (logBusy = `Lese ${n} … ${k} von ${f.size} Byte`)));
      }
      const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return all;
    });
  }
  const readLog = () => logRun("Lese das Log …", async () => {
    const b = await fetchLog();
    logSize = b.length;
    logRecs = decodeLog(b).reverse();
  });
  const saveLog = () => logRun("Lese das Log …", async () => {
    const b = await fetchLog();
    saveFile(b.slice().buffer, `forge-log-${new Date().toISOString().slice(0, 10)}.bin`);
  });
  const clearLog = () => {
    if (!confirm("Das Log auf der Karte löschen (FORGE.LOG und FORGE.OLD)?")) return;
    logRun("Lösche das Log …", () => withSd(async (l) => {
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
    if (busy || !confirm("Alle Fehlerzähler im Gerät zurücksetzen?")) return;
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
    rOut = v === null ? `keine Antwort${a?.message ? ` (${a.message})` : ""}` : `0x${hex2(v)} = ${v} = ${v.toString(2).padStart(8, "0")}b`;
  }
  async function writeReg() {
    const v = h(rVal);
    if (Number.isNaN(v) || v > 0xff) { rOut = "Wert: zwei Hex-Ziffern"; return; }
    if (!confirm(`Register 0x${hex2(h(rReg))} von Baustein 0x${hex2(h(rAddr))} an Bus ${rBus} auf 0x${hex2(v)} setzen?\n\nEin falscher Wert kann den Ton stören, bis der Forge neu gestartet wird.`)) return;
    const err = await writeOnce(`i2c.${rBus}.${h(rAddr)}.${h(rReg)}`, v);
    rOut = err ? `abgelehnt: ${err}` : "geschrieben";
    if (!err) await readReg();
  }

  function report(): string {
    const id = d.identity, L: string[] = [];
    L.push(`Forge DSP Diagnosebericht, ${new Date().toISOString()}`, `GUI ${__APP_VERSION__} (${__APP_COMMIT__})`, "");
    L.push(`Modell: ${id.model} PCB ${id.pcb}`, `Firmware: ${id.port ? `Port ${id.port} (Protokoll ${id.firmware})` : id.firmware}`,
      `Abtastrate: ${id.sampleRate}`, `Verbindung: ${app.transportName}`, "");
    if (hw) L.push(`Hardwareprüfung: ${hw.ok ? "ok" : "ABWEICHUNG"} (DSP erwartet ${hw.dsp[0]}, gefunden ${hw.dsp[1]}; übrige erwartet ${hw.other[0]}, gefunden ${hw.other[1]})`);
    L.push(`Temperatur: ${d.temperature?.toFixed(1) ?? "-"} °C`);
    if (supply) L.push(`3,3 V: ${supply[0]} mV, Bordspannung: ${supply[1] >= 0 ? supply[1] + " mV" : "nicht eingerichtet"}`);
    if (rx !== null) L.push(`CT7302 0x7A: 0x${hex2(rx)} (${ct7302Locked(rx) ? "eingerastet" : "kein Signal"})`);
    if (dac !== null) L.push(`ES9018 Reg. 27: 0x${hex2(dac)} (${es9018Locked(dac) ? "eingerastet" : "nicht eingerastet"})`);
    if (boot) for (const b of boot.buses) L.push(`DSP-Start Bus ${b.bus}: Beginn ${b.startMs} ms, ${b.edges} Flanken, Ruhe nach ${b.quietMs} ms, Grenze ${b.timeout ? "ERREICHT" : "nein"}, Nachfragen ${b.retries}`);
    if (boot?.restarted) L.push("Dieser Start folgte auf einen Neustart wegen fehlender DSP-Kerne.");
    L.push("", "Fehlerzähler:");
    L.push(...(d.errors.length ? d.errors.map(([c, n]) => `  ${c}: ${n}x  ${errorName(c)}`) : ["  keine"]));
    for (const bus of [1, 2]) if (scans[bus]) L.push("", `I2C-Bus ${bus}:`, ...scans[bus].map((a) => `  0x${hex2(a)}  ${chipAt(bus, a)?.name ?? "unbekannt"}  ${chipAt(bus, a)?.role ?? ""}`));
    return L.join("\n") + "\n";  // without the serial number: reports get attached to public issues
  }
  function download() {
    saveFile(report(), `forge-diagnose-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain");
  }
</script>

<header class="head">
  <div>
    <h2>Diagnose</h2>
    <p class="muted">Zustand der Bausteine im Forge. {#if checked}Stand {checked}.{/if}</p>
  </div>
  <div class="acts">
    <button onclick={refresh} disabled={busy}><Icon name="refresh" size={16} /> {busy ? "Prüfe …" : "Neu prüfen"}</button>
    <button onclick={download} disabled={!checked}>Bericht speichern</button>
    <button onclick={saveState} disabled={app.status !== "online"}
      title="Alles, was die Oberfläche vom Gerät gelesen hat, als JSON-Datei (für Fehlerberichte und Vergleiche)">Zustand speichern</button>
  </div>
</header>

<div class="tiles">
  <section class="panel tile">
    <h3>Gerät</h3>
    <dl>
      <dt>Hardwareprüfung</dt>
      <dd>{#if hw}<span class="state" class:ok={hw.ok} class:bad={!hw.ok}>{hw.ok ? "alle Bausteine gefunden" : "Bausteine fehlen, Ausgänge stumm"}</span>{:else}–{/if}</dd>
      <dt>Temperatur</dt><dd class="num">{d.temperature !== null ? `${d.temperature.toFixed(1)} °C` : "–"}</dd>
      {#if supply}
        <dt>3,3-V-Schiene</dt><dd class="num">{(supply[0] / 1000).toFixed(2)} V</dd>
        <dt>Bordspannung</dt><dd class="num">{supply[1] >= 0 ? `${(supply[1] / 1000).toFixed(2)} V` : "nicht eingerichtet"}</dd>
      {/if}
    </dl>
  </section>
  <section class="panel tile">
    <h3>Signal</h3>
    {#if port}
      <dl>
        <dt>S/PDIF-Empfänger</dt>
        <dd>{#if rx !== null}<span class="state" class:ok={ct7302Locked(rx)}>{ct7302Locked(rx) ? "eingerastet" : "kein Signal"}</span>
          <span class="muted num">0x{hex2(rx)}</span>{:else}–{/if}</dd>
        <dt>D/A-Wandler</dt>
        <dd>{#if dac !== null}<span class="state" class:ok={es9018Locked(dac)}>{es9018Locked(dac) ? "eingerastet" : "wartet auf Takt"}</span>
          <span class="muted num">0x{hex2(dac)}</span>{:else if scans[2]}<span class="muted">kein ES9018 an Bus 2</span>{:else}–{/if}</dd>
        {#if boot}
          {#each boot.buses as b}
            <dt>DSP-Start Bus {b.bus}</dt>
            <dd class="num">{b.quietMs} ms{#if b.retries}, {b.retries} Nachfragen{/if}{#if b.timeout}<span class="state bad"> Zeitgrenze</span>{/if}</dd>
          {/each}
          {#if boot.restarted}<dt>Neustart</dt><dd><span class="state bad">nach fehlenden DSP-Kernen</span></dd>{/if}
        {/if}
      </dl>
    {:else}
      <p class="muted">Der direkte Blick auf die Bausteine braucht die Port-Firmware (ab 2.0.0).</p>
    {/if}
  </section>
  <section class="panel tile">
    <div class="tilehead">
      <h3>Fehlerzähler</h3>
      {#if port && d.errors.length}
        <button class="ghost small" onclick={clearErrors} disabled={busy}
          title="Alle Fehlerzähler im Gerät auf null setzen">Zurücksetzen</button>
      {/if}
    </div>
    {#if clearError}<p class="err small">{clearError}</p>{/if}
    {#if d.errors.length}
      <table class="errs"><tbody>
        {#each d.errors as [code, n]}<tr><td class="num">{n}×</td><td>{errorName(code)}</td><td class="muted num">{code}</td></tr>{/each}
      </tbody></table>
      <p class="muted small">Seit dem letzten Löschen gezählt, nicht seit dem Einschalten.</p>
    {:else}<p class="muted">Keine Einträge.</p>{/if}
  </section>
</div>

{#if port}
  <div class="tiles two">
    {#each [1, 2] as bus}
      <section class="panel tile">
        <h3>I2C-Bus {bus}</h3>
        {#if scans[bus]}
          <table class="chips"><tbody>
            {#each scans[bus] as a}
              {@const c = chipAt(bus, a)}
              <tr><td class="num">0x{hex2(a)}</td><td>{c?.name ?? "unbekannt"}</td><td class="muted">{c?.role ?? ""}</td></tr>
            {/each}
          </tbody></table>
        {:else}<p class="muted">Noch nicht geprüft.</p>{/if}
      </section>
    {/each}
  </div>

  <section class="panel tile reg">
    <h3>Register</h3>
    <div class="regrow">
      <label>Bus <select bind:value={rBus}><option value={1}>1</option><option value={2}>2</option></select></label>
      <label>Baustein 0x<input class="num hx" bind:value={rAddr} maxlength="2" spellcheck="false" /></label>
      <label>Register 0x<input class="num hx" bind:value={rReg} maxlength="2" spellcheck="false" /></label>
      <button onclick={readReg} disabled={!rOk || isEeprom(h(rAddr))}>Lesen</button>
      {#if expert}
        <label>Wert 0x<input class="num hx" bind:value={rVal} maxlength="2" spellcheck="false" /></label>
        <button onclick={writeReg} disabled={!rOk || isEeprom(h(rAddr))}>Schreiben</button>
      {/if}
      <span class="num out">{rOut}</span>
    </div>
    <label class="check"><input type="checkbox" bind:checked={expert} /> Schreiben erlauben (Expertenmodus)</label>
    {#if isEeprom(h(rAddr))}<p class="muted small">Die Speicherbausteine (0xA0–0xAF) gibt die Firmware nicht frei.</p>{/if}
  </section>

  <section class="panel tile log">
    <div class="tilehead">
      <h3>Log auf der Speicherkarte</h3>
      <div class="acts">
        <button onclick={readLog} disabled={!!logBusy}>Lesen</button>
        <button onclick={saveLog} disabled={!!logBusy}>Herunterladen</button>
        <button class="ghost danger" onclick={clearLog} disabled={!!logBusy}>Löschen</button>
      </div>
    </div>
    <div class="logset">
      <label class="check"><input type="checkbox" checked={logOn} disabled={dbgOut === null || !!logBusy}
        onchange={(e) => setLog((e.target as HTMLInputElement).checked)} /> Ereignisse auf die Karte schreiben</label>
      <label class="check">Stufe
        <select value={dbgMode || 4} disabled={!logOn || !!logBusy}
          onchange={(e) => setLog(true, Number((e.target as HTMLSelectElement).value))}>
          {#each LOG_LEVELS as t, i}{#if i > 0 && i < 7}<option value={i}>{i} {t}</option>{/if}{/each}
        </select>
      </label>
      <span class="muted small">Im Forge gespeichert (<code>system.debug.out</code> Bit 2, <code>system.debug.mode</code>), wirkt sofort.</span>
    </div>
    {#if logBusy}<p class="busytext small">{logBusy}</p>{/if}
    {#if logError}<p class="err small">{logError}</p>{/if}
    {#if logRecs}
      {#if logRecs.length}
        <p class="muted small">{logRecs.length} Einträge ({logSize} Byte), neueste zuerst.</p>
        <table class="logt">
          <thead><tr><th>Start</th><th>Zeit</th><th>Stufe</th><th>Bereich</th><th>Ereignis</th></tr></thead>
          <tbody>
            {#each logRecs.slice(0, logShow) as r, i (i)}
              <tr class:first={r.module === 1 && r.event === 1}>
                <td class="num">{r.boot}</td><td class="num">{ms(r.ms)}</td>
                <td class={LEVEL_CLASS[r.level] ?? ""}>{LOG_LEVELS[r.level] ?? r.level}</td>
                <td>{logModule(r.module)}</td><td>{logText(r)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if logRecs.length > logShow}<button class="ghost" onclick={() => (logShow += 200)}>Ältere zeigen</button>{/if}
      {:else}<p class="muted">Kein Log auf der Karte.</p>{/if}
    {/if}
  </section>
{/if}

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .acts { display: flex; gap: .5rem; }
  .acts button { display: inline-flex; align-items: center; gap: .4rem; }
  .tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); margin-bottom: .75rem; align-items: start; }
  .tile { padding: .9rem 1rem; display: grid; gap: .6rem; align-content: start; }
  .tilehead { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
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
  code { font-family: var(--mono); font-size: .9em; }
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

<script lang="ts">
  import { explain } from "../lib/errors";
  import { saveFile } from "../lib/saveFile";
  import { app, query, reload, updateAccess } from "../lib/app.svelte";
  import { isPort, parseScan } from "../lib/device";
  import { APP_SIZE, imageKnows } from "../lib/boot/client";
  import { HexError, parseHex } from "../lib/boot/ihex";
  import { runUpdate, STEP_LABEL, UpdateError, type Step } from "../lib/boot/update";
  import { assetsFor, fetchAsset, loadReleases, type Release } from "../lib/boot/releases";

  const d = $derived(app.device);
  const id = $derived(d.identity);
  const identity = $derived(id.model && id.pcb ? `${id.model}-${id.pcb}` : "");
  const usb = $derived(!!updateAccess() && app.status === "online");
  const port = $derived(isPort(d));

  let file = $state<{ name: string; image: Uint8Array; sha: string } | null>(null);
  let fileError = $state("");
  let hasClock = $state<boolean | null>(null);
  let backup = $state(true);
  let understood = $state(false);
  let running = $state(false);
  let steps = $state<{ step: Step; done?: number; total?: number }[]>([]);
  let result = $state<{ ok: boolean; text: string; touched?: boolean } | null>(null);
  /** the backup of this update, kept until the page is left (offered as buttons as well) */
  let saved = $state<{ flash: Uint8Array; eeprom: Uint8Array; flashName: string; eepromName: string } | null>(null);

  $effect(() => {  // the clock generator tells PCB 3.0 from 4.x, both report "96ELN-4.0"
    if (port && app.status === "online" && hasClock === null && !running)
      query("i2c.1.scan").then((a) => { const s = parseScan(a[0]?.value); if (s.length) hasClock = s.includes(0xe0) || s.includes(0xe2); });
  });

  /** a .hex (from the PC or a release) as the image to write; the checks below apply to both */
  async function useHex(name: string, text: () => Promise<string>) {
    file = null; fileError = ""; result = null; understood = false;
    try {
      const image = parseHex(await text());
      if (!image.length) throw new HexError("Die Datei enthält keine Daten.");
      if (image.length > APP_SIZE) throw new HexError("Das Image ist größer als der Anwendungsbereich des Forge.");
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
  const fitting = $derived(rel && id.model ? assetsFor(rel, id.model, id.pcb, hasClock) : []);
  const others = $derived(rel ? rel.assets.filter((a) => !fitting.includes(a)) : []);
  $effect(() => {  // propose the file of this device whenever the release or the device changes
    rel; fitting;
    relFile = fitting[0]?.file ?? "";
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
    if (identity) c.push(imageKnows(file.image, id.model, id.pcb)
      ? ["ok", `Das Image kennt dieses Gerät (${identity}).`]
      : ["warn", `Modell ${id.model} mit PCB ${id.pcb} kommt im Image nicht vor. Es ist vermutlich für ein anderes Gerät.`]);
    const v30 = /V30/i.test(file.name), v4x = /V4[x01]/i.test(file.name);
    if (hasClock !== null && (v30 || v4x)) c.push(v30 === !hasClock
      ? ["ok", `Platine passt zum Dateinamen (${hasClock ? "mit" : "ohne"} Taktgenerator).`]
      : ["bad", `Der Dateiname nennt ${v30 ? "PCB 3.0" : "PCB 4.x"}, dieses Gerät hat ${hasClock ? "einen" : "keinen"} Taktgenerator, ist also ${hasClock ? "PCB 4.x" : "PCB 3.0"}.`]);
    else if (id.model === "96ELN") c.push(["warn", "96ELN mit PCB 3.0 und 4.0 melden dieselbe Kennung. Bitte selbst prüfen, dass das Image zur Platine passt."]);
    if (/bascom|1\.11\.6000/i.test(file.name)) c.push(["warn", "Das ist die Original-Firmware. Mit ihr geht ein späteres Update nur noch mit dem Taster am Gerät, nicht mehr von hier."]);
    return c;
  });
  const blocked = $derived(checks.some(([s]) => s === "bad"));
  const needsTick = $derived(checks.some(([s]) => s === "warn"));

  function download(data: Uint8Array, name: string) {
    saveFile(data as BlobPart, name);
  }

  async function start() {
    const io = updateAccess();
    if (!io || !file || running) return;
    if (!confirm(`Firmware „${file.name}“ jetzt auf den Forge schreiben?\n\nDie Musik stoppt. Währenddessen den Forge nicht ausschalten und das USB-Kabel stecken lassen.`)) return;
    running = true; app.exclusive = true; steps = []; result = null; saved = null;
    const day = new Date().toISOString().slice(0, 10);
    try {
      const r = await runUpdate({ ...io,
        onStep: (step, done, total) => {
          const last = steps[steps.length - 1];
          if (last?.step === step) { last.done = done; last.total = total; } else steps.push({ step, done, total });
        },
        onBackup: (flash, eeprom) => {
          saved = { flash, eeprom, flashName: `forge-${identity}-flash-${day}.bin`, eepromName: `forge-${identity}-eeprom-${day}.bin` };
          download(flash, saved.flashName);  // the browser may block downloads that no click started: buttons below
          download(eeprom, saved.eepromName);
        },
      }, { image: file.image, backup, identity });
      result = { ok: true, text: `Fertig: ${r.written} Bytes geschrieben und geprüft, die neue Firmware läuft.` };
      app.exclusive = false;
      await reload();
    } catch (e) {
      const u = e instanceof UpdateError ? e : null;
      result = { ok: false, text: u ? `${STEP_LABEL[u.step]}: ${explain(u.message)}` : explain(e), touched: u?.flashTouched };
    } finally {
      running = false; app.exclusive = false;
    }
  }
  const pct = (s: { done?: number; total?: number }) => (s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null);
</script>

<header class="head">
  <div>
    <h2>Firmware</h2>
    <p class="muted">Firmware des Forge aktualisieren. Die Abstimmung bleibt dabei erhalten.</p>
  </div>
</header>

<div class="cols">
  <section class="panel box">
    <h3>Dieses Gerät</h3>
    <dl>
      <dt>Modell</dt><dd>{id.model || "–"} <span class="muted">PCB {id.pcb || "–"}</span></dd>
      <dt>Firmware</dt><dd class="num">{id.port ? `Port ${id.port}` : id.firmware ? `Original ${id.firmware}` : "–"}</dd>
      {#if hasClock !== null}<dt>Taktgenerator</dt><dd>{hasClock ? "vorhanden (PCB 4.x)" : "nicht vorhanden (PCB 3.0)"}</dd>{/if}
    </dl>
    <p class="muted small">Firmware-Dateien (<code>.hex</code>) gibt es unter
      <a href="https://github.com/psych0d0g/forge-dsp-firmware/releases" target="_blank" rel="noreferrer">forge-dsp-firmware/releases</a>.
      Dort steht auch, welche Datei zu welchem Gerät gehört.</p>
  </section>

  <section class="panel box">
    <h3>Update</h3>
    {#if !usb}
      <p class="muted">Das Update geht nur über die USB-Verbindung, nicht über die ESP32-Brücke.</p>
    {:else if !port}
      <p class="muted">Auf diesem Gerät läuft die Original-Firmware. Sie kann den Bootloader nicht selbst starten: Das erste Update auf
        die Port-Firmware braucht den Taster am Gerät und das Werkzeug <code>c45b3</code> aus dem Firmware-Repository. Danach gehen
        Updates von hier.</p>
    {:else}
      <div class="relwrap">
      {#if releases}
        <div class="rel">
          {#if newer}<p class="new">Neue Version verfügbar: <strong>{newer.name}</strong> vom {newer.date}.</p>{/if}
          <div class="relrow">
            <label>Release
              <select bind:value={relTag} disabled={running || relBusy}>
                {#each releases as r}<option value={r.tag}>{r.name}{r.original ? " (Original)" : ""} · {r.date}</option>{/each}
              </select>
            </label>
            <label>Datei
              <select bind:value={relFile} disabled={running || relBusy}>
                {#if fitting.length}<optgroup label="passt zu diesem Gerät">{#each fitting as a}<option value={a.file}>{a.file}</option>{/each}</optgroup>{/if}
                {#if others.length}<optgroup label="für andere Geräte">{#each others as a}<option value={a.file}>{a.file}</option>{/each}</optgroup>{/if}
              </select>
            </label>
            <button onclick={loadRelease} disabled={running || relBusy || !relFile}>{relBusy ? "Lade …" : "Laden"}</button>
          </div>
          {#if rel}<p class="muted small"><a href={rel.url} target="_blank" rel="noreferrer">Release-Notizen</a> · geladen von dieser Seite,
            geprüft gegen die Prüfsumme des Release</p>{/if}
        </div>
        <p class="muted small or">oder eine Datei vom Rechner:</p>
      {/if}
      </div>
      <label class="filebtn" class:disabled={running}>Firmware-Datei wählen …<input type="file" accept=".hex" onchange={pick} disabled={running} /></label>
      {#if fileError}<p class="bad">{fileError}</p>{/if}
      {#if file}
        <dl>
          <dt>Datei</dt><dd>{file.name}</dd>
          <dt>Größe</dt><dd class="num">{file.image.length} Bytes</dd>
          <dt>SHA-256</dt><dd class="num sha" title="mit SHA256SUMS des Release vergleichen">{file.sha}</dd>
        </dl>
        <ul class="checks">{#each checks as [s, t]}<li class={s}>{t}</li>{/each}</ul>
        <label class="check"><input type="checkbox" bind:checked={backup} disabled={running} /> vorher sichern (alte Firmware und
          Einstellungen als Dateien, dauert etwa 2 Minuten)</label>
        {#if needsTick && !blocked}
          <label class="check"><input type="checkbox" bind:checked={understood} disabled={running} /> Hinweise gelesen, dieses Image ist richtig</label>
        {/if}
        <div><button class="primary" disabled={running || blocked || (needsTick && !understood)} onclick={start}>Update starten</button></div>
      {/if}
    {/if}

    {#if steps.length}
      <ol class="steps">
        {#each steps as s, i}
          <li class:now={running && i === steps.length - 1}>
            <span>{STEP_LABEL[s.step]}</span>
            {#if pct(s) !== null}<progress value={s.done} max={s.total}></progress><span class="num muted">{pct(s)} %</span>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if saved}
      <div class="saved">
        <span class="muted small">Sicherung vor dem Update ({saved.flash.length + saved.eeprom.length} Bytes), bleibt bis zum Verlassen der Seite:</span>
        <div class="btns">
          <button onclick={() => download(saved!.flash, saved!.flashName)}>Flash-Sicherung speichern</button>
          <button onclick={() => download(saved!.eeprom, saved!.eepromName)}>EEPROM-Sicherung speichern</button>
        </div>
      </div>
    {/if}
    {#if result}
      <div class="result" class:ok={result.ok} class:bad={!result.ok} role="status">
        <p>{result.text}</p>
        {#if result.touched}
          <p>Die alte Firmware ist nicht mehr vollständig. Der Bootloader ist unverändert und wartet: USB stecken lassen,
            Gerät nicht ausschalten und „Update starten“ noch einmal drücken.</p>
        {:else if !result.ok}
          <p>Am Gerät wurde nichts verändert.</p>
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
  code { font-family: var(--mono); font-size: .9em; }
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
  .saved { display: grid; gap: .35rem; border-top: 1px solid var(--line); padding-top: .6rem; }
  .saved .btns { display: flex; gap: .5rem; flex-wrap: wrap; }
  .result { border: 1px solid var(--line-strong); border-radius: 10px; padding: .6rem .8rem; display: grid; gap: .3rem; }
  .result.ok { border-color: var(--ok); color: var(--ok); }
  .result.bad { border-color: var(--err); }
  @media (max-width: 60rem) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>

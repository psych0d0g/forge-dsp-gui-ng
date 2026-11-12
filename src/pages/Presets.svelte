<script lang="ts">
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
  const load = (n: number) => run(`Preset ${n + 1} wird geladen …`, async () => {
    const err = await writeOnce("preset.loaded", n);
    if (err) return `Laden abgelehnt: ${err}`;
    await sleep(2500);  // the device mutes, loads and unmutes
    await reload();
  });
  const copy = (n: number) => run(`Kopiere nach Preset ${n + 1} …`, async () => {
    if (!confirm(`Das geladene Preset ${loaded! + 1} nach Preset ${n + 1} kopieren? Preset ${n + 1} wird überschrieben.`)) return;
    const err = await writeOnce("preset.copy", n);
    await sleep(1500);
    return err ? `Kopieren abgelehnt: ${err}` : `Preset ${loaded! + 1} nach ${n + 1} kopiert.`;
  });
  const erase = (n: number) => run(`Lösche Preset ${n + 1} …`, async () => {
    if (!confirm(`Preset ${n + 1} löschen? Alle Einstellungen dieses Presets gehen verloren.`)) return;
    const err = await writeOnce("preset.erase", n);
    await sleep(1500);
    if (!err && n === loaded) await reload();
    return err ? `Löschen abgelehnt: ${err}` : `Preset ${n + 1} gelöscht.`;
  });
  const startWith = (n: number) => run("Speichere …", async () => {
    const err = await writeOnce("preset.select", n);
    if (!err) d.preset.select = n;
    return err ? `Abgelehnt: ${err}` : `Der Forge startet künftig mit Preset ${n + 1}.`;
  });

  // --- file ---------------------------------------------------------------------------------
  function save() {
    const cfg = toCfg(d.identity.model, stateToEntries(d), [
      `Forge DSP ${d.identity.model}, Preset ${loaded !== null ? loaded + 1 : "?"}, ${new Date().toISOString().slice(0, 16)}`,
      `forge-dsp-gui-ng ${__APP_VERSION__} (${__APP_COMMIT__})`]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([cfg], { type: "text/plain" }));
    a.download = `forge-${d.identity.model}-preset${loaded !== null ? loaded + 1 : ""}-${new Date().toISOString().slice(0, 10)}.cfg`;
    a.click();
    URL.revokeObjectURL(a.href);
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
    return errors ? `${n - errors} von ${n} Werten geschrieben, ${errors} vom Gerät abgelehnt.` : `${n} Werte geschrieben.`;
  });
</script>

<header class="head">
  <div>
    <h2>Presets</h2>
    <p class="muted">Ein Preset ist eine komplette Abstimmung im Gerät. Änderungen auf den anderen Seiten landen immer im
      geladenen Preset.</p>
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
          <span class="muted small">{loaded === n ? "geladen" : " "}{d.preset.select === n ? " · beim Start" : ""}</span>
        </div>
      </div>
      <div class="btns">
        {#if loaded === n}
          <button disabled={!!busy || d.preset.select === n} onclick={() => startWith(n)}>Beim Start laden</button>
        {:else}
          <button class="primary" disabled={!!busy} onclick={() => load(n)}>Laden</button>
          <button disabled={!!busy || loaded === null} title="Das geladene Preset hierher kopieren" onclick={() => copy(n)}>Hierher kopieren</button>
        {/if}
        <button class="ghost danger" disabled={!!busy} onclick={() => erase(n)}>Löschen</button>
      </div>
    </section>
  {/each}
</div>

<section class="panel box">
  <h3>Abstimmung als Datei</h3>
  <p class="muted">Sichert das geladene Preset mit Mixer, Pegeln, Laufzeiten, Filtern, Kanalnamen und Steuerblöcken. Das Format
    ist das der bisherigen Forge-Software (<code>.cfg</code>), vorhandene Dateien lassen sich also einspielen.</p>
  <div class="btns">
    <button onclick={save} disabled={!!busy}>Als Datei sichern</button>
    <label class="filebtn" class:disabled={!!busy}>Datei einspielen …<input type="file" accept=".cfg,.txt" onchange={pick} disabled={!!busy} /></label>
  </div>
  {#if file}
    <div class="restore">
      <p><strong>{file.name}</strong>{#if file.model} für <span class="num">{file.model}</span>{/if}:
        {file.entries.length} Werte, davon <strong>{file.todo.length}</strong> anders als im Gerät.
        {#if file.refused}<span class="warn">{file.refused} Zeilen mit anderen Befehlen werden nicht geschrieben.</span>{/if}</p>
      {#if !modelFits}
        <p class="warn">Die Datei ist für ein {file.model}, angeschlossen ist ein {d.identity.model}. Sie wird nicht eingespielt.</p>
      {:else if file.todo.length}
        <p class="muted">Geschrieben wird in das geladene Preset {loaded !== null ? loaded + 1 : ""}. Vorher sichern, wenn es noch gebraucht wird.</p>
        <div class="btns">
          <button class="primary" disabled={!!busy} onclick={restore}>{file.todo.length} Werte schreiben</button>
          <button disabled={!!busy} onclick={() => (file = null)}>Abbrechen</button>
        </div>
      {:else}
        <p class="muted">Das Gerät hat schon genau diese Abstimmung.</p>
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
  code { font-family: var(--mono); font-size: .9em; }
  .filebtn { padding: .42rem .85rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); cursor: pointer; }
  .filebtn.disabled { opacity: .45; cursor: default; }
  .filebtn input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .filebtn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .restore { border-top: 1px solid var(--line); padding-top: .7rem; display: grid; gap: .5rem; }
  .warn { color: var(--warn); }
</style>

<script lang="ts">
  import { app, setMaster } from "../lib/app.svelte";
  import { masterDb, masterOf, masterValue } from "../lib/device";

  // Master volume in the top bar (GUI-#3): the two volume events of the MODC block "Lautstärke",
  // attenuation on top of the preset like the rotary encoder; the stored levels stay as they are.
  const MIN_DB = -60;
  const m = $derived(masterOf(app.device));
  const v = $derived(m ? app.device.events[m.odd] : undefined);
  const db = $derived(v === undefined ? null : masterDb(v));
  const text = $derived(db === null ? "–" : db <= MIN_DB ? "−∞" : db === 0 ? "0" : `−${Math.abs(db).toFixed(db % 1 ? 1 : 0)}`);
  function input(e: Event) {
    const x = Number((e.target as HTMLInputElement).value);
    setMaster(x <= MIN_DB ? 0 : masterValue(x));
  }
  function key(e: KeyboardEvent) {  // 0.5 dB per step, Shift: 3 dB
    if (!m || db === null) return;
    const step = e.shiftKey ? 3 : 0.5;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") setMaster(masterValue(Math.min(0, db + step)));
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") setMaster(masterValue(Math.max(MIN_DB, db - step)));
    else return;
    e.preventDefault();
  }
</script>

{#if m}
  <label class="master" title="Master-Lautstärke (Steuerblock {m.block} „Lautstärke“): senkt alle Ausgänge über der gespeicherten Abstimmung ab, wie der Drehregler. Pfeiltasten 0,5 dB, mit Umschalt 3 dB.">
    <span class="lbl">Master</span>
    <input type="range" min={MIN_DB} max="0" step="0.5" value={db ?? MIN_DB} disabled={db === null}
      oninput={input} onkeydown={key} aria-label="Master-Lautstärke" aria-valuetext="{text} dB" />
    <span class="num val">{text} dB</span>
  </label>
{:else if app.device.identity.firmware}
  <button class="ghost nomaster" onclick={() => (app.page = "modc")}
    title="Für eine Master-Lautstärke unter Steuerung › Steuerblöcke einen Block „Lautstärke“ anlegen und ihm zwei Ereignisse geben (ungerade/gerade Ausgänge). Er senkt dann alle Ausgänge über der Abstimmung ab, auch per Drehregler oder Fernbedienung.">
    Master einrichten …</button>
{/if}

<style>
  .nomaster { font-size: .78rem; color: var(--muted); }
  .master { display: flex; align-items: center; gap: .5rem; }
  .lbl { font-size: .72rem; color: var(--muted); }
  .val { font-size: .78rem; min-width: 3.6rem; text-align: right; }
  input[type="range"] { width: 9rem; accent-color: var(--accent); }
  @media (max-width: 40rem) { .lbl { display: none; } input[type="range"] { width: 5.5rem; } }
</style>

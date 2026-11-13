<script lang="ts">
  import { app, inName, meter, outName, setVuFloor, VU_FLOORS, type PageId } from "../lib/app.svelte";
  import { INPUT_PAIRS, rawToDb } from "../lib/device";
  import Icon from "../components/Icon.svelte";
  import LevelBar from "../components/LevelBar.svelte";

  const d = $derived(app.device);
  const id = $derived(d.identity);
  const serial = $derived(id.keyInfo.split("-")[3] ?? "");
  const allBq = $derived(Object.values(d.biquads).flatMap((c) => Object.values(c)));
  const activeBq = $derived(allBq.filter((b) => b.type !== 0 && (b.flags & 0x80) !== 0).length);
  const delayed = $derived(d.delay.out.filter((x) => x > 0).length);
  const go = (p: PageId) => (app.page = p);
  const db = (raw: number) => {
    const s = d.scales.out;
    if (!s) return "";
    if (raw <= s.min) return "−∞";
    const v = rawToDb(s, raw);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  };
  const stages = $derived([
    { page: "mixer" as PageId, icon: "inputs", title: "Eingänge",
      lines: [`${id.analogInPairs} analoge Paare`, `${id.spdifPairs} digital`] },
    { page: "mixer" as PageId, icon: "mixer", title: "Mixer",
      lines: [`Profil ${d.mixer.position || "–"}`, d.mixer.input !== null ? `Quelle ${d.mixer.input}` : ""] },
    { page: "filters" as PageId, icon: "filters", title: "Filter & EQ",
      lines: [`${activeBq} aktiv`, `von ${allBq.length}`] },
    { page: "delay" as PageId, icon: "delay", title: "Laufzeit",
      lines: [delayed ? `${delayed} Kanäle verzögert` : "keine Verzögerung"] },
  ]);
</script>

<header class="head">
  <div>
    <h2>{id.model ? `Forge DSP ${id.model}` : "Übersicht"}</h2>
    <p class="muted">Der Signalweg von links nach rechts. Ein Klick auf eine Stufe öffnet sie.</p>
  </div>
  {#if d.vu}
    <label class="floor muted">Pegelanzeige ab
      <select value={meter.floor} onchange={(e) => setVuFloor(Number((e.target as HTMLSelectElement).value))}
        title="Ab welchem Pegel die Balken anfangen. Tiefer zeigt auch leise Signale und Rauschen, etwa zum Einstellen der Gain-Regler an den Analogeingängen.">
        {#each VU_FLOORS as f}<option value={f}>{f} dBFS</option>{/each}
      </select>
    </label>
  {/if}
</header>

<div class="flow">
  {#each stages as s}
    <button class="panel stage" onclick={() => go(s.page)}>
      <span class="ico"><Icon name={s.icon} size={20} /></span>
      <strong>{s.title}</strong>
      {#each s.lines as l}{#if l}<span class="muted">{l}</span>{/if}{/each}
      {#if s.title === "Eingänge" && d.vu}
        <div class="levels">
          {#each INPUT_PAIRS as p}
            {#each p.in as n}
              <span class="lv-n">{inName(n)}</span><LevelBar value={d.vu[n - 1]} label={inName(n)} number />
            {/each}
          {/each}
        </div>
      {/if}
    </button>
    <span class="arrow" aria-hidden="true"></span>
  {/each}
  <button class="panel stage outs" onclick={() => go("mixer")}>
    <span class="ico"><Icon name="outputs" size={20} /></span>
    <strong>Ausgänge</strong>
    <div class="chans">
      {#each d.gain.out as raw, i}
        <div class="chan" class:muted={!!d.mute[i]}>
          <span class="n num">{i + 1}</span>
          <span class="nm">{outName(i + 1)}</span>
          <span class="v num">{d.mute[i] ? "stumm" : `${db(raw)} dB`}</span>
          {#if d.vuOut}<span class="lvl"><LevelBar value={d.vuOut[i]} label={d.mute[i] ? `${outName(i + 1)} (stumm, Pegel vor dem DAC)` : outName(i + 1)} /></span>{/if}
        </div>
      {/each}
    </div>
  </button>
</div>

<div class="tiles">
  <section class="panel tile">
    <h3>Gerät</h3>
    <dl>
      <dt>Modell</dt><dd>{id.model || "–"} <span class="muted">PCB {id.pcb || "–"}</span></dd>
      <dt>Firmware</dt><dd class="num">{id.port ? `Port ${id.port}` : id.firmware || "–"}
        {#if id.port}<span class="muted">(Protokoll {id.firmware})</span>{/if}</dd>
      <dt>Abtastrate</dt><dd class="num">{id.sampleRate ? `${id.sampleRate / 1000} kHz` : "–"}</dd>
      <dt>Seriennummer</dt><dd class="num">{serial || "–"}</dd>
    </dl>
  </section>
  <section class="panel tile">
    <h3>Zustand</h3>
    <dl>
      <dt>Preset</dt><dd class="num">{d.preset.loaded !== null ? d.preset.loaded + 1 : "–"} <span class="muted">von {id.presets || "–"}</span></dd>
      <dt>Temperatur</dt><dd class="num">{d.temperature !== null ? `${d.temperature.toFixed(1)} °C` : "–"}</dd>
      <dt>Clickless</dt><dd>{d.clickless === null ? "nicht verfügbar" : d.clickless ? "ein" : "aus"}</dd>
      <dt>Fehlerzähler</dt><dd class="num">{d.errors.length ? `${d.errors.length} Einträge` : "keine"}</dd>
    </dl>
  </section>
</div>

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .floor { display: inline-flex; align-items: center; gap: .5rem; font-size: .82rem; }
  .floor select { font: inherit; padding: .25rem .4rem; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--fg); }
  .levels :global(.wrap) { min-width: 0; }
  /* the inputs are wider: their level bars are used to set the analog gain pots */
  .flow { display: grid; grid-template-columns: minmax(13rem, 1.6fr) 1.5rem repeat(3, minmax(7.5rem, .8fr) 1.5rem) minmax(17rem, 2.4fr); align-items: stretch; }
  .stage { display: flex; flex-direction: column; align-items: flex-start; gap: .15rem; padding: .9rem 1rem; text-align: left; font: inherit; }
  .stage:hover:not(:disabled) { border-color: var(--accent); background: var(--panel); }
  .ico { color: var(--accent); margin-bottom: .35rem; }
  .arrow { align-self: center; height: 2px; background: var(--line-strong); position: relative; }
  .arrow::after { content: ""; position: absolute; right: 0; top: -4px; border: 5px solid transparent; border-left-color: var(--line-strong); border-right: 0; }
  .chans { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem 1rem; width: 100%; margin-top: .3rem; }
  .chan { display: flex; gap: .45rem; align-items: baseline; font-size: .82rem; min-width: 0; }
  .chan .n { color: var(--faint); }
  .chan .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chan .v { color: var(--muted); }
  .chan { flex-wrap: wrap; }
  .chan .lvl { flex-basis: 100%; padding: .05rem 0 .25rem 1rem; }
  /* mute acts in the DAC, after the measuring point: the level is there but not audible */
  .chan.muted .lvl { opacity: .3; }
  .levels { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: .2rem .5rem; width: 100%; margin-top: .45rem; }
  .lv-n { font-size: .7rem; color: var(--muted); white-space: nowrap; }
  .chan.muted .v { color: var(--err); }
  .tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); margin-top: .75rem; }
  .tile { padding: .9rem 1rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.25rem; margin: .6rem 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 62rem) {
    .flow { grid-template-columns: 1fr; }
    .arrow { width: 2px; height: 1rem; justify-self: center; }
    .arrow::after { right: -4px; top: auto; bottom: 0; border: 5px solid transparent; border-top-color: var(--line-strong); border-bottom: 0; }
  }
</style>

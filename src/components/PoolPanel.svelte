<script lang="ts">
  import { app, outName, setPoolLengths } from "../lib/app.svelte";
  import { checkLengths, freeOf, lastUsed, lostBands, poolCores, type PoolCore } from "../lib/device";

  let { colorOf, current, busy = $bindable(""), onapplied }: {
    colorOf: (ch: number) => string;
    /** channel shown on the page, highlighted */
    current: number;
    busy?: string;
    onapplied?: () => void;
  } = $props();

  const d = $derived(app.device);
  const cores = $derived(poolCores(d));
  const name = (ch: number) => (ch === 35 ? "Summe A" : ch === 36 ? "Summe B" : outName(ch));
  const coreName = (k: PoolCore) => {
    const chs = k.channels.map((c) => c.ch).filter((c) => c < 30);
    return chs.length ? `Kern ${k.core} · Ausgänge ${Math.min(...chs)}–${Math.max(...chs)}` : `Kern ${k.core} · Summen A/B`;
  };

  // edited lengths per core; the device values until something is typed
  let edit = $state<Record<number, number[]>>({});
  const lens = (k: PoolCore) => edit[k.core] ?? k.channels.map((c) => c.len);
  const changed = (k: PoolCore) => !!edit[k.core] && edit[k.core].some((n, i) => n !== k.channels[i].len);
  function set(k: PoolCore, i: number, v: number) {
    const l = [...lens(k)];
    l[i] = Math.max(0, Math.round(v) || 0);
    edit[k.core] = l;
  }
  let error = $state("");

  async function apply(k: PoolCore) {
    const l = lens(k);
    const why = checkLengths(k, l);
    if (why) { error = why; return; }
    const lost = lostBands(d, k, l);
    const loss = lost.map((x) => `${name(x.ch)}: Band ${x.bands.join(", ")}`).join("\n");
    if (!confirm(`Biquads von ${coreName(k)} neu verteilen?\n\n` +
      k.channels.map((c, i) => `${name(c.ch)}: ${c.len} → ${l[i]}`).join("\n") +
      (loss ? `\n\nDiese belegten Bänder fallen weg (in allen Presets):\n${loss}` : "") +
      `\n\nDer Forge startet dafür neu, rund 40 s ohne Ton. Die übrigen Bänder aller Presets bleiben erhalten.`)) return;
    error = "";
    busy = "…";
    error = await setPoolLengths(k.core, l, (t) => (busy = t));
    busy = "";
    if (!error) { delete edit[k.core]; onapplied?.(); }
  }
</script>

<section class="panel block">
  <div class="blockhead">
    <h3>Biquad-Verteilung</h3>
    <span class="muted small">Jeder DSP-Kern hat einen gemeinsamen Vorrat. Die Zahl der Filterplätze je Kanal lässt sich verschieben;
      gespeicherte Bänder wandern mit.</span>
  </div>
  {#each cores as k (k.core)}
    {@const l = lens(k)}
    {@const free = freeOf(k, l)}
    {@const why = checkLengths(k, l)}
    <div class="core">
      <div class="corehead">
        <span class="cname">{coreName(k)}</span>
        <span class="muted small num">{k.size - free} von {k.size} verteilt{free > 0 ? `, ${free} frei` : ""}</span>
      </div>
      <div class="bar" role="img" aria-label="Aufteilung {coreName(k)}">
        {#each k.channels as c, i (c.ch)}
          {@const used = Math.min(lastUsed(d, c.ch), l[i])}
          <div class="seg" class:cur={c.ch === current} style="flex: {Math.max(l[i], 0)} 1 0; --c: {colorOf(c.ch)}" title="{name(c.ch)}: {l[i]} Biquads, bis Band {lastUsed(d, c.ch)} belegt">
            <div class="usedpart" style="width: {l[i] ? (100 * used) / l[i] : 0}%"></div>
          </div>
        {/each}
        {#if free > 0}<div class="seg free" style="flex: {free} 1 0"></div>{/if}
      </div>
      <div class="fields">
        {#each k.channels as c, i (c.ch)}
          {@const lost = lastUsed(d, c.ch) > l[i]}
          <label class="f" class:cur={c.ch === current}>
            <span><i style="background: {colorOf(c.ch)}"></i>{name(c.ch)}</span>
            <input class="num" class:bad={l[i] < c.min || lost} type="number" min={c.min} max={255} value={l[i]} disabled={!!busy}
              onchange={(e) => set(k, i, Number((e.target as HTMLInputElement).value))} />
            <small class="muted">{lost ? `Band ${lastUsed(d, c.ch)} fiele weg` : `min. ${Math.max(c.min, 1)}, belegt bis ${lastUsed(d, c.ch)}`}</small>
          </label>
        {/each}
        <div class="actions">
          {#if changed(k)}
            <button onclick={() => delete edit[k.core]} disabled={!!busy}>Zurück</button>
            <button class="primary" onclick={() => apply(k)} disabled={!!busy || !!why} title={why || "Übernehmen (Neustart)"}>Übernehmen</button>
          {/if}
        </div>
      </div>
      {#if changed(k) && why}<p class="err small">{why}</p>{/if}
    </div>
  {/each}
  {#if busy}<p class="busy small">{busy}</p>{/if}
  {#if error}<p class="err small">{error}</p>{/if}
</section>

<style>
  .block { padding: .8rem 1rem; display: grid; gap: .7rem; }
  .blockhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem 1rem; }
  .blockhead h3 { margin: 0; }
  .core { display: grid; gap: .4rem; }
  .corehead { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .cname { font-weight: 600; font-size: .88rem; }
  .bar { display: flex; height: .9rem; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); background: var(--raised); }
  .seg { position: relative; min-width: 2px; background: color-mix(in srgb, var(--c) 30%, transparent); border-right: 1px solid var(--panel); }
  .seg.cur { background: color-mix(in srgb, var(--c) 45%, transparent); }
  .seg .usedpart { position: absolute; inset: 0 auto 0 0; background: var(--c); opacity: .85; }
  .seg.free { background: repeating-linear-gradient(45deg, transparent 0 4px, var(--line) 4px 6px); }
  .fields { display: flex; flex-wrap: wrap; gap: .5rem .9rem; align-items: end; }
  .f { display: grid; gap: .15rem; font-size: .78rem; min-width: 7.5rem; }
  .f span { display: inline-flex; align-items: center; gap: .35rem; color: var(--muted); }
  .f.cur span { color: var(--text, inherit); font-weight: 600; }
  .f i { width: .6rem; height: .6rem; border-radius: 3px; display: inline-block; }
  .f input { width: 5.5rem; }
  .f input.bad { border-color: var(--warn); }
  .actions { display: flex; gap: .5rem; margin-left: auto; }
  .err { color: var(--err); margin: 0; }
  .busy { color: var(--accent); margin: 0; }
  .small { font-size: .78rem; }
</style>

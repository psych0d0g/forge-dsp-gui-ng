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
  // outputs in ascending order, the signal sums always last
  const firstCh = (k: PoolCore) => Math.min(...k.channels.map((c) => (c.ch > 30 ? 100 + c.ch : c.ch)));
  const cores = $derived(poolCores(d).sort((a, b) => firstCh(a) - firstCh(b)));
  const name = (ch: number) => (ch === 35 ? "Summe A" : ch === 36 ? "Summe B" : outName(ch));
  const coreName = (k: PoolCore) => {
    const chs = k.channels.map((c) => c.ch).filter((c) => c < 30);
    return chs.length ? `Kern ${k.core} · Ausgänge ${Math.min(...chs)}–${Math.max(...chs)}` : `Kern ${k.core} · Summen A/B`;
  };

  // edited lengths per core; the device values until something is changed
  let edit = $state<Record<number, number[]>>({});
  const lens = (k: PoolCore) => edit[k.core] ?? k.channels.map((c) => c.len);
  const changed = (k: PoolCore) => !!edit[k.core] && edit[k.core].some((n, i) => n !== k.channels[i].len);
  function set(k: PoolCore, i: number, v: number) {
    const l = [...lens(k)];
    l[i] = Math.max(0, Math.min(255, Math.round(v) || 0));
    edit[k.core] = l;
  }
  function typed(e: Event, k: PoolCore, i: number) {
    const el = e.target as HTMLInputElement;
    const v = Number(el.value.trim());
    if (el.value.trim() && Number.isFinite(v)) set(k, i, v);
    el.value = String(lens(k)[i]);
  }

  /**
   * Moves the border after channel i by delta biquads: channel i takes them from its right
   * neighbour, or after the last channel from the free ones (or gives them back there);
   * no channel goes below its minimum.
   */
  function shift(k: PoolCore, start: number[], i: number, delta: number) {
    const last = i === k.channels.length - 1;
    const right = last ? freeOf(k, start) : start[i + 1] - Math.max(1, k.channels[i + 1].min);
    const left = start[i] - Math.max(1, k.channels[i].min);
    delta = Math.max(-left, Math.min(right, delta));
    const l = [...start];
    l[i] += delta;
    if (!last) l[i + 1] -= delta;
    edit[k.core] = l;
  }

  let drag = $state<{ k: PoolCore; i: number; x: number; width: number; start: number[] } | null>(null);
  function down(e: PointerEvent, k: PoolCore, i: number) {
    if (busy) return;
    const bar = (e.currentTarget as HTMLElement).closest(".bar") as HTMLElement;
    drag = { k, i, x: e.clientX, width: bar.clientWidth, start: [...lens(k)] };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (drag) shift(drag.k, drag.start, drag.i, Math.round(((e.clientX - drag.x) / drag.width) * drag.k.size));
  }
  function key(e: KeyboardEvent, k: PoolCore, i: number) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") shift(k, lens(k), i, -step);
    else if (e.key === "ArrowRight") shift(k, lens(k), i, step);
    else return;
    e.preventDefault();
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

<svelte:window onpointerup={() => (drag = null)} onpointercancel={() => (drag = null)} />

<section class="panel block" class:dragging={!!drag}>
  {#each cores as k (k.core)}
    {@const l = lens(k)}
    {@const free = freeOf(k, l)}
    {@const why = checkLengths(k, l)}
    <div class="core">
      <div class="corehead">
        <span class="cname">{coreName(k)}</span>
        <span class="muted small num">{k.size - free} von {k.size} verteilt{free > 0 ? `, ${free} frei` : ""}</span>
      </div>
      <div class="bar" role="group" aria-label="Aufteilung {coreName(k)}, Grenzen mit der Maus oder den Pfeiltasten verschieben">
        {#each k.channels as c, i (c.ch)}
          {@const used = lastUsed(d, c.ch)}
          <div class="seg" class:cur={c.ch === current} class:short={used > l[i]} style="flex: {Math.max(l[i], 0)} 1 0; --c: {colorOf(c.ch)}"
            title="{name(c.ch)}: {l[i]} Biquads, belegt bis Band {used}">
            <div class="usedpart" style="width: {l[i] ? Math.min(100, (100 * used) / l[i]) : 0}%"></div>
            <span class="lbl num">{name(c.ch)} · {l[i]}</span>
          </div>
          <!-- a focusable separator is a splitter (ARIA window splitter pattern) -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div class="handle" class:active={drag?.k.core === k.core && drag.i === i} role="separator" aria-orientation="vertical" tabindex="0"
            aria-valuenow={l[i]} aria-label="Grenze nach {name(c.ch)}" title="Ziehen verschiebt die Grenze (Pfeiltasten: 1, mit Umschalt: 10)"
            onpointerdown={(e) => down(e, k, i)} onpointermove={move} onkeydown={(e) => key(e, k, i)}><i></i></div>
        {/each}
        {#if free > 0}<div class="seg free" style="flex: {free} 1 0" title="{free} frei"></div>{/if}
      </div>
      <div class="fields">
        {#each k.channels as c, i (c.ch)}
          {@const used = lastUsed(d, c.ch)}
          <div class="field" class:cur={c.ch === current} class:short={used > l[i]}>
            <span class="who"><i style="background: {colorOf(c.ch)}"></i>{name(c.ch)}</span>
            <label class="val num"><input value={l[i]} inputmode="numeric" disabled={!!busy} aria-label="Biquads {name(c.ch)}"
              onchange={(e) => typed(e, k, i)}
              onkeydown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); set(k, i, l[i] + (e.key === "ArrowUp" ? 1 : -1)); } }} /><span>Biquads</span></label>
            <small>{used > l[i] ? `Band ${used} fiele weg` : `min. ${Math.max(c.min, 1)} · belegt bis ${used}`}</small>
          </div>
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
  .block { padding: .9rem 1rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.3rem; margin-top: .9rem; }
  .dragging { cursor: col-resize; }
  .core { display: grid; grid-template-columns: minmax(0, 1fr); gap: .55rem; }
  .corehead { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .cname { font-weight: 600; font-size: .88rem; }
  .bar { display: flex; height: 2.1rem; border-radius: 8px; border: 1px solid var(--line); background: var(--raised); user-select: none; touch-action: none; }
  .seg { position: relative; min-width: 0; overflow: hidden; background: color-mix(in srgb, var(--c) 20%, transparent); }
  .seg:first-child { border-radius: 7px 0 0 7px; }
  .seg:last-child, .seg.free { border-radius: 0 7px 7px 0; }
  .seg.cur { background: color-mix(in srgb, var(--c) 34%, transparent); }
  .seg .usedpart { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, var(--c) 68%, transparent); }
  .seg.short { box-shadow: inset 0 0 0 2px var(--warn); }
  .seg .lbl { position: relative; display: block; padding: 0 .55rem; line-height: 2.1rem; font-size: .74rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
  .seg.free { background: repeating-linear-gradient(45deg, transparent 0 5px, var(--line) 5px 7px); }
  .handle { flex: none; position: relative; width: 12px; margin: 0 -6px; z-index: 1; cursor: col-resize; display: grid; place-items: center; touch-action: none; }
  .handle i { width: 3px; height: 1.3rem; border-radius: 2px; background: var(--panel); box-shadow: 0 0 0 1px var(--line-strong); transition: background .12s, width .12s; }
  .handle:hover i, .handle:focus-visible i, .handle.active i { background: var(--accent); box-shadow: none; width: 4px; }
  .handle:focus-visible { outline: none; }
  .fields { display: flex; flex-wrap: wrap; gap: .45rem; align-items: stretch; }
  .field { display: grid; gap: .05rem; padding: .4rem .65rem .45rem; min-width: 8.5rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
  .field.cur { border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
  .who { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--muted); }
  .who i { width: .6rem; height: .6rem; border-radius: 3px; display: inline-block; }
  .val { display: inline-flex; align-items: baseline; gap: .3rem; font-size: .76rem; color: var(--muted); }
  .val input { width: 3.1rem; text-align: right; border: 1px solid transparent; background: none; padding: .05rem .25rem; border-radius: 6px; font: inherit; font-size: 1.05rem; color: var(--fg); }
  .val input:hover { border-color: var(--line-strong); }
  .val input:focus { border-color: var(--accent); outline: none; background: var(--panel); }
  .field small { font-size: .7rem; color: var(--muted); }
  .field.short small, .field.short input { color: var(--warn); }
  .actions { display: flex; gap: .5rem; margin-left: auto; align-self: center; }
  .err { color: var(--err); margin: 0; }
  .busy { color: var(--accent); margin: 0; }
  .small { font-size: .78rem; }
</style>

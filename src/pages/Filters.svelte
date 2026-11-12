<script lang="ts">
  import { app, outName, write } from "../lib/app.svelte";
  import { isPort, limitsOf, type Biquad } from "../lib/device";
  import { isActive, typeInfo, TYPES } from "../lib/dsp/biquad";
  import ResponsePlot from "../components/ResponsePlot.svelte";
  import Icon from "../components/Icon.svelte";

  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const rate = $derived(d.identity.sampleRate || 96000);
  const port = $derived(isPort(d));
  // channels as the firmware numbers them: outputs 1..n, 35/36 = the two buses of the mixer
  const BUS: Record<number, string> = { 35: "Bus A", 36: "Bus B" };
  const channels = $derived(Object.keys(d.biquads).map(Number).sort((a, b) => (a > 30 ? a - 100 : a) - (b > 30 ? b - 100 : b)));
  const chName = (ch: number) => BUS[ch] ?? outName(ch);
  let ch = $state(0);
  $effect(() => {
    if (!channels.includes(ch)) ch = channels.find((c) => c < 30) ?? channels[0] ?? 0;
  });
  const slots = $derived(Object.entries(d.biquads[ch] ?? {}).map(([n, bq]) => ({ n: Number(n), bq })).sort((a, b) => a.n - b.n));
  const used = $derived(slots.filter((s) => s.bq.type !== 0));
  let selected = $state<number | null>(null);
  let showPhase = $state(false);
  let linked = $state(false);
  const partner = (c: number) => (c > 30 ? (c === 35 ? 36 : 35) : c % 2 ? c + 1 : c - 1);
  const groups = [...new Set(TYPES.map((t) => t.group))].filter((g) => g !== "Aus");

  function send(c: number, n: number, bq: Biquad) {
    write(`biquad.${c}.${n}.calc`, [bq.type, bq.f, bq.gain, bq.q, bq.b, bq.flags]);
  }
  /** change a filter of this channel (and of its partner when linked) */
  function update(n: number, patch: Partial<Biquad>) {
    for (const c of linked && d.biquads[partner(ch)]?.[n] ? [ch, partner(ch)] : [ch]) {
      const bq = { ...d.biquads[c][n], ...patch };
      d.biquads[c][n] = bq;
      send(c, n, bq);
    }
  }
  const clamp = (v: number, [a, b]: [number, number]) => Math.max(a, Math.min(b, v));
  function setType(n: number, type: number) {
    const bq = d.biquads[ch][n], t = typeInfo(type);
    const patch: Partial<Biquad> = { type, flags: bq.flags | 0x80 };
    if (!bq.f) patch.f = 1000;
    if (t?.q && !bq.q) patch.q = 707;
    if (t?.b === "Winkel (°)" && !(bq.b >= 1 && bq.b < 360)) patch.b = 90;
    if (t?.b === "Bandbreite (Hz)" && !bq.b) patch.b = Math.round((patch.f ?? bq.f) / 3) || 100;
    if (!t?.gain) patch.gain = 0;
    update(n, patch);
  }
  function add() {
    const free = slots.find((s) => s.bq.type === 0);
    if (!free) return;
    update(free.n, { type: 1, f: 1000, gain: 0, q: 1414, b: 0, flags: 128 });
    selected = free.n;
  }
  function remove(n: number) {
    update(n, { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 });
    if (selected === n) selected = null;
  }
  function num(e: Event, n: number, key: "f" | "gain" | "q" | "b", scale: number, range: [number, number]) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", "."));
    if (!Number.isNaN(v)) update(n, { [key]: clamp(Math.round(v * scale), range) });
    el.value = String(d.biquads[ch][n][key] / scale);
  }
</script>

<header class="head">
  <div>
    <h2>Filter & EQ</h2>
    <p class="muted">Weichen, Equalizer und Phasenfilter je Kanal. Punkte im Diagramm ziehen ändert Frequenz und Pegel, das
      Mausrad auf einem Punkt die Güte.</p>
  </div>
</header>

<div class="chans" role="tablist" aria-label="Kanal">
  {#each channels as c}
    {@const n = Object.values(d.biquads[c]).filter(isActive).length}
    <button role="tab" aria-selected={ch === c} class:on={ch === c} class:bus={c > 30} onclick={() => { ch = c; selected = null; }}>
      {#if c < 30}<span class="num n">{c}</span>{/if}<span>{chName(c)}</span>{#if n}<span class="tag num">{n}</span>{/if}
    </button>
  {/each}
</div>

<section class="panel plot">
  <div class="plothead">
    <h3>{chName(ch)}</h3>
    <label class="check"><input type="checkbox" bind:checked={showPhase} /> Phase</label>
    {#if d.biquads[partner(ch)]}
      <label class="check" title="Jede Änderung auch auf {chName(partner(ch))} anwenden">
        <input type="checkbox" bind:checked={linked} /> mit {chName(partner(ch))} koppeln</label>
    {/if}
  </div>
  <ResponsePlot filters={slots} {rate} freq={lim.freq} gainRange={lim.bqGain} {selected} {showPhase}
    onselect={(n) => (selected = n)}
    onmove={(n, f, g) => update(n, g === null ? { f } : { f, gain: g })}
    onq={(n, k) => update(n, { q: clamp(Math.round(d.biquads[ch][n].q * k), lim.bqQ) })} />
</section>

<section class="panel list">
  <div class="listhead">
    <h3>Filter <span class="muted num">{used.length} von {slots.length}</span></h3>
    <button onclick={add} disabled={used.length >= slots.length}>+ Filter</button>
  </div>
  {#if !used.length}
    <p class="muted">Dieser Kanal hat noch keine Filter.</p>
  {/if}
  {#each used as { n, bq } (n)}
    {@const t = typeInfo(bq.type)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="frow" class:sel={selected === n} class:off={!isActive(bq)} onpointerdown={() => (selected = n)} onfocusin={() => (selected = n)}>
      <span class="nr num">{n}</span>
      <button class="sw" class:on={isActive(bq)} aria-pressed={isActive(bq)} title="Filter ein/aus"
        onclick={() => update(n, { flags: bq.flags ^ 0x80 })}>{isActive(bq) ? "Ein" : "Aus"}</button>
      <select value={bq.type} aria-label="Typ Filter {n}" onchange={(e) => setType(n, Number(e.currentTarget.value))}>
        {#if !t}<option value={bq.type}>Typ {bq.type}</option>{/if}
        {#each groups as g}
          <optgroup label={g}>
            {#each TYPES.filter((x) => x.group === g) as x}
              <option value={x.type} disabled={x.port && !port}>{x.name}{x.port && !port ? " (nur Port-Firmware)" : ""}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <label class="f"><span>Frequenz</span><span class="in"><input class="num" value={bq.f} inputmode="numeric"
        onchange={(e) => num(e, n, "f", 1, lim.freq)} /><i>Hz</i></span></label>
      {#if t?.gain}
        <label class="f"><span>Pegel</span><span class="in"><input class="num" value={bq.gain / 10} inputmode="decimal"
          onchange={(e) => num(e, n, "gain", 10, lim.bqGain)} /><i>dB</i></span></label>
      {/if}
      {#if t?.q}
        <label class="f"><span>Güte</span><span class="in"><input class="num" value={bq.q / 1000} inputmode="decimal"
          onchange={(e) => num(e, n, "q", 1000, lim.bqQ)} /><i>Q</i></span></label>
      {/if}
      {#if t?.b}
        <label class="f"><span>{t.b === "Winkel (°)" ? "Winkel" : "Bandbreite"}</span><span class="in"><input class="num" value={bq.b} inputmode="numeric"
          onchange={(e) => num(e, n, "b", 1, t.b === "Winkel (°)" ? [1, 359] : lim.bqB)} /><i>{t.b === "Winkel (°)" ? "°" : "Hz"}</i></span></label>
      {/if}
      <button class="ghost del" title="Filter entfernen" aria-label="Filter {n} entfernen" onclick={() => remove(n)}><Icon name="close" size={16} /></button>
    </div>
  {/each}
</section>

<style>
  .head { margin-bottom: 1rem; }
  .chans { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .75rem; }
  .chans button { display: inline-flex; align-items: center; gap: .45rem; padding: .35rem .7rem; color: var(--muted); }
  .chans button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--fg); }
  .chans .n { color: var(--faint); }
  .chans .bus { border-style: dashed; }
  .plot { padding: .8rem 1rem .4rem; }
  .plothead { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin-bottom: .3rem; }
  .plothead h3 { margin-right: auto; }
  .check { display: inline-flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; }
  .check input { accent-color: var(--accent); }
  .list { margin-top: .75rem; padding: .8rem 1rem; display: grid; gap: .3rem; }
  .listhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: .2rem; }
  .frow { display: flex; align-items: flex-end; gap: .6rem; flex-wrap: wrap; padding: .45rem .5rem; border: 1px solid transparent; border-radius: 10px; }
  .frow.sel { border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .frow.off { opacity: .6; }
  .nr { width: 1.6rem; height: 2rem; display: grid; place-items: center; color: var(--muted); }
  .sw { width: 3rem; padding: .38rem 0; font-size: .8rem; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--accent); }
  select { padding: .4rem .5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); min-width: 13rem; flex: 1 1 13rem; max-width: 19rem; }
  select option, select optgroup { background: var(--bg); }
  .f { display: grid; gap: .1rem; font-size: .7rem; color: var(--muted); }
  .in { display: flex; align-items: baseline; gap: .25rem; }
  .in input { width: 5rem; text-align: right; font-size: .9rem; }
  .in i { font-style: normal; font-size: .75rem; width: 1.2rem; }
  .del { margin-left: auto; color: var(--muted); padding: .35rem .55rem; }
</style>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { app, outName, write } from "../lib/app.svelte";
  import { isPort, limitsOf, sumsActiveAnywhere, type Biquad } from "../lib/device";
  import { isActive, typeInfo, TYPES, viewRange } from "../lib/dsp/biquad";
  import ResponsePlot from "../components/ResponsePlot.svelte";
  import Icon from "../components/Icon.svelte";
  import VFader from "../components/VFader.svelte";
  import Knob from "../components/Knob.svelte";

  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const rate = $derived(d.identity.sampleRate || 96000);
  const port = $derived(isPort(d));
  // channels as the firmware numbers them: outputs 1..n, 35/36 = the two signal sums of the mixer
  const BUS: Record<number, string> = { 35: "Summe A", 36: "Summe B" };
  // outputs first, the sums (35/36) last and only while "All Over" is on in the mixer
  const channels = $derived(Object.keys(d.biquads).map(Number).filter((c) => c < 30 || sumsActiveAnywhere(d)).sort((a, b) => a - b));
  const chName = (ch: number) => BUS[ch] ?? outName(ch);
  let ch = $state(0);
  $effect(() => {
    if (!channels.includes(ch)) ch = channels.find((c) => c < 30) ?? channels[0] ?? 0;
  });
  const slots = $derived(Object.entries(d.biquads[ch] ?? {}).map(([n, bq]) => ({ n: Number(n), bq })).sort((a, b) => a.n - b.n));
  let selected = $state<number | null>(null);
  let showPhase = $state(false);
  let linked = $state(false);
  const partner = (c: number) => (c > 30 ? (c === 35 ? 36 : 35) : c % 2 ? c + 1 : c - 1);

  // Two kinds of biquads: EQ bands (peaking, by Q or by bandwidth) below the curve, and filters
  // (crossovers, shelves, notch, all passes …) with knobs above it.
  const EQ_Q = 1, EQ_BW = 18;
  const isBand = (bq: Biquad) => bq.type === EQ_Q || bq.type === EQ_BW;
  const FILTER_TYPES = TYPES.filter((t) => t.type !== 0 && t.type !== EQ_Q && t.type !== EQ_BW);
  const GROUP_LABEL: Record<string, string> = { EQ: "Shelf, Notch, Bandpass" };
  const filterGroups = [...new Set(FILTER_TYPES.map((t) => t.group))];

  // Both lists line up by frequency. The order is only taken over when an interaction ends
  // (pointer released, field left, added, removed), so nothing moves away under the hand.
  let order = $state<number[]>([]);
  const byFreq = () => slots.filter((s) => s.bq.type !== 0).sort((a, b) => a.bq.f - b.bq.f || a.n - b.n).map((s) => s.n);
  // The curve shows the section where this channel's filters are. Like the order it follows only
  // when an interaction ends, so the axis does not move while a point is dragged.
  let zoom = $state(true);
  let view = $state<[number, number] | undefined>(undefined);
  const section = () => viewRange(slots.filter((s) => isActive(s.bq) && s.bq.type !== 19).map((s) => s.bq.f), lim.freq);
  async function resort() {
    view = section();
    const next = byFreq();
    if (next.length === order.length && next.every((n, i) => n === order[i])) return;
    const el = document.activeElement as HTMLElement | null;
    order = next;
    await tick();
    if (el && el.isConnected && document.activeElement !== el) el.focus();  // moving a node may drop the focus
  }
  $effect(() => {
    ch;
    order = untrack(byFreq);  // only the channel is a dependency
    view = untrack(section);
  });
  const used = $derived([
    ...order.map((n) => slots.find((s) => s.n === n)).filter((s): s is { n: number; bq: Biquad } => !!s && s.bq.type !== 0),
    ...slots.filter((s) => s.bq.type !== 0 && !order.includes(s.n)),  // just added, not sorted in yet
  ]);
  const bands = $derived(used.filter((s) => isBand(s.bq)));
  const filters = $derived(used.filter((s) => !isBand(s.bq)));
  /** label in lists and on the curve: bands 1, 2, 3 …, filters A, B, C … */
  const tag = (n: number) => {
    const b = bands.findIndex((s) => s.n === n);
    return b >= 0 ? String(b + 1) : String.fromCharCode(65 + Math.max(0, filters.findIndex((s) => s.n === n)));
  };
  const free = $derived(slots.length - used.length);

  function send(c: number, n: number, bq: Biquad) {
    write(`biquad.${c}.${n}.calc`, [bq.type, bq.f, bq.gain, bq.q, bq.b, bq.flags]);
  }
  /** change a biquad of this channel (and of its partner when linked) */
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
  function add(kind: "band" | "filter") {
    const slot = slots.find((s) => s.bq.type === 0);
    if (!slot) return;
    update(slot.n, kind === "band" ? { type: EQ_Q, f: 1000, gain: 0, q: 1414, b: 707, flags: 128 }
      : { type: 9, f: 80, gain: 0, q: 707, b: 0, flags: 128 });  // Butterworth high pass
    selected = slot.n;
    resort();
  }
  function remove(n: number) {
    update(n, { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 });
    if (selected === n) selected = null;
    resort();
  }
  /** an EQ band by Q or by bandwidth: the same filter, the other parameter (Q = f / bandwidth) */
  function bandMode(n: number, bq: Biquad, byBandwidth: boolean) {
    if (byBandwidth === (bq.type === EQ_BW)) return;
    if (byBandwidth) update(n, { type: EQ_BW, b: clamp(Math.round(bq.f / Math.max(bq.q / 1000, 0.001)), [1, lim.bqB[1]]) });
    else update(n, { type: EQ_Q, q: clamp(Math.round((bq.f / Math.max(bq.b, 1)) * 1000), lim.bqQ) });
  }
  function num(e: Event, n: number, key: "f" | "gain" | "q" | "b", scale: number, range: [number, number]) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", "."));
    if (!Number.isNaN(v)) update(n, { [key]: clamp(Math.round(v * scale), range) });
    el.value = String(d.biquads[ch][n][key] / scale);
    resort();
  }
  // Tab in a value field of a band goes to the same field of the next band (Shift+Tab: previous)
  function tabAcross(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const el = e.currentTarget as HTMLInputElement;
    const row = [...(el.closest(".strips")?.querySelectorAll<HTMLInputElement>(`input[data-k="${el.dataset.k}"]:not(:disabled)`) ?? [])];
    const next = row[row.indexOf(el) + (e.shiftKey ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.select();
  }

  // knobs on a logarithmic scale: position 0..STEPS, the value field shows the real unit
  const STEPS = 600;
  const toPos = (v: number, [lo, hi]: [number, number]) => Math.round((Math.log(clamp(v || lo, [lo, hi]) / lo) / Math.log(hi / lo)) * STEPS);
  const fromPos = (p: number, [lo, hi]: [number, number]) => lo * Math.pow(hi / lo, p / STEPS);
  const qRange = $derived<[number, number]>([Math.max(100, lim.bqQ[0]), lim.bqQ[1]]);   // 0.1 … 10
  const bwRange = $derived<[number, number]>([Math.max(1, lim.bqB[0]), lim.bqB[1]]);
  const parseNum = (t: string) => { const v = Number(t.replace(",", ".").replace("−", "-")); return Number.isNaN(v) ? null : v; };
  const fmtHz = (f: number) => String(Math.round(f));

  const gainFrac = (g: number) => (g - lim.bqGain[0]) / (lim.bqGain[1] - lim.bqGain[0]);
  const fmtG = (g: number) => `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g / 10).toFixed(1)} dB`;
</script>

<svelte:window onpointerup={resort} />

<header class="head">
  <div>
    <h2>Filter & EQ</h2>
    <p class="muted">Oben die Filter des Kanals (Weichen, Shelf, Phase), unten die EQ-Bänder. Punkte in der Kurve lassen sich ziehen,
      das Mausrad auf einem Punkt ändert die Güte.</p>
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

<!-- filters: crossovers, shelves, notch, all passes -->
<section class="panel block">
  <div class="blockhead"><h3>Filter <span class="muted num">{filters.length}</span></h3></div>
  <div class="cards">
    {#each filters as { n, bq } (n)}
      {@const t = typeInfo(bq.type)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="card" class:sel={selected === n} class:off={!isActive(bq)} onpointerdown={() => (selected = n)} onfocusin={() => (selected = n)}>
        <div class="cardhead">
          <span class="nr">{tag(n)}</span>
          <select value={bq.type} aria-label="Typ Filter {tag(n)}" title={t?.name ?? ""} onchange={(e) => setType(n, Number(e.currentTarget.value))}>
            {#if !t}<option value={bq.type}>Typ {bq.type}</option>{/if}
            {#each filterGroups as g}
              <optgroup label={GROUP_LABEL[g] ?? g}>
                {#each FILTER_TYPES.filter((x) => x.group === g) as x}
                  <option value={x.type} disabled={x.port && !port}>{x.name}{x.port && !port ? " (nur Port-Firmware)" : ""}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          <button class="sw" class:on={isActive(bq)} aria-pressed={isActive(bq)} title="Filter ein/aus"
            onclick={() => update(n, { flags: bq.flags ^ 0x80 })}>{isActive(bq) ? "Ein" : "Aus"}</button>
          <button class="ghost del" title="Filter entfernen" aria-label="Filter {tag(n)} entfernen" onclick={() => remove(n)}><Icon name="close" size={14} /></button>
        </div>
        <div class="knobs">
          {#if bq.type !== 19}
            <Knob size={46} caption="Frequenz" unit="Hz" label="Frequenz Filter {tag(n)}" min={0} max={STEPS} value={toPos(bq.f, lim.freq)}
              display={() => fmtHz(bq.f)} parse={(tx) => { const v = parseNum(tx); return v === null ? null : toPos(v, lim.freq); }}
              onchange={(p) => update(n, { f: Math.round(fromPos(p, lim.freq)) })} />
          {/if}
          {#if t?.gain}
            <Knob size={46} caption="Pegel" unit="dB" label="Pegel Filter {tag(n)}" min={lim.bqGain[0]} max={lim.bqGain[1]} value={bq.gain}
              display={(v) => (v / 10).toFixed(1)} parse={(tx) => { const v = parseNum(tx); return v === null ? null : Math.round(v * 10); }}
              onchange={(v) => update(n, { gain: v })} />
          {/if}
          {#if t?.q}
            <Knob size={46} caption="Güte" unit="Q" label="Güte Filter {tag(n)}" min={0} max={STEPS} value={toPos(bq.q, qRange)}
              display={() => String(bq.q / 1000)} parse={(tx) => { const v = parseNum(tx); return v === null ? null : toPos(v * 1000, qRange); }}
              onchange={(p) => update(n, { q: Math.round(fromPos(p, qRange)) })} />
          {/if}
          {#if t?.b === "Winkel (°)"}
            <Knob size={46} caption="Winkel" unit="°" label="Winkel Filter {tag(n)}" min={1} max={359} value={clamp(bq.b, [1, 359])}
              onchange={(v) => update(n, { b: v })} />
          {:else if t?.b}
            <Knob size={46} caption="Bandbreite" unit="Hz" label="Bandbreite Filter {tag(n)}" min={0} max={STEPS} value={toPos(bq.b, bwRange)}
              display={() => fmtHz(bq.b)} parse={(tx) => { const v = parseNum(tx); return v === null ? null : toPos(v, bwRange); }}
              onchange={(p) => update(n, { b: Math.round(fromPos(p, bwRange)) })} />
          {/if}
        </div>
      </div>
    {/each}
    <button class="add" onclick={() => add("filter")} disabled={!free} title="Filter hinzufügen"><span class="plus">+</span><span>Filter</span></button>
  </div>
</section>

<section class="panel plot">
  <div class="plothead">
    <h3>{chName(ch)}</h3>
    <label class="check" title="Nur den Frequenzbereich zeigen, in dem die Filter dieses Kanals liegen"><input type="checkbox" bind:checked={zoom} /> Ausschnitt</label>
    <label class="check"><input type="checkbox" bind:checked={showPhase} /> Phase</label>
    {#if d.biquads[partner(ch)]}
      <label class="check" title="Jede Änderung auch auf {chName(partner(ch))} anwenden">
        <input type="checkbox" bind:checked={linked} /> mit {chName(partner(ch))} koppeln</label>
    {/if}
  </div>
  <ResponsePlot filters={used.map((s) => ({ ...s, label: tag(s.n) }))} {rate} freq={lim.freq} view={zoom ? view : undefined} gainRange={lim.bqGain} {selected} {showPhase}
    onselect={(n) => (selected = n)}
    onmove={(n, f, g) => update(n, g === null ? { f } : { f, gain: g })}
    onq={(n, k) => update(n, { q: clamp(Math.round(d.biquads[ch][n].q * k), lim.bqQ) })} />
</section>

<!-- EQ bands -->
<section class="panel block">
  <div class="blockhead"><h3>EQ-Bänder <span class="muted num">{bands.length}</span></h3>
    <span class="muted small">{free} von {slots.length} Plätzen dieses Kanals frei</span></div>
  <div class="strips">
    {#each bands as { n, bq } (n)}
      {@const bw = bq.type === EQ_BW}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="strip" class:sel={selected === n} class:off={!isActive(bq)} onpointerdown={() => (selected = n)} onfocusin={() => (selected = n)}>
        <div class="striphead">
          <span class="nr">{tag(n)}</span>
          <button class="ghost del" title="Band entfernen" aria-label="Band {tag(n)} entfernen" onclick={() => remove(n)}><Icon name="close" size={14} /></button>
        </div>
        <button class="sw" class:on={isActive(bq)} aria-pressed={isActive(bq)} title="Band ein/aus"
          onclick={() => update(n, { flags: bq.flags ^ 0x80 })}>{isActive(bq) ? "Ein" : "Aus"}</button>
        <div class="fader">
          <VFader frac={gainFrac(bq.gain)} zero={gainFrac(0)} label="Pegel Band {tag(n)}" valuetext={fmtG(bq.gain)}
            onfrac={(f) => update(n, { gain: Math.round(lim.bqGain[0] + f * (lim.bqGain[1] - lim.bqGain[0])) })}
            onstep={(dir) => update(n, { gain: clamp(bq.gain + dir * 5, lim.bqGain) })} />
        </div>
        <label class="f"><span>Pegel dB</span><input class="num" data-k="gain" onkeydown={tabAcross} value={bq.gain / 10} inputmode="decimal"
          onchange={(e) => num(e, n, "gain", 10, lim.bqGain)} /></label>
        <label class="f"><span>Frequenz Hz</span><input class="num" data-k="f" onkeydown={tabAcross} value={bq.f} inputmode="numeric"
          onchange={(e) => num(e, n, "f", 1, lim.freq)} /></label>
        <div class="f">
          <span class="mode" role="group" aria-label="Breite des Bands angeben als">
            <button class:on={!bw} aria-pressed={!bw} title="Breite als Güte (Q)" onclick={() => bandMode(n, bq, false)}>Q</button>
            <button class:on={bw} aria-pressed={bw} title="Breite als Bandbreite in Hz" onclick={() => bandMode(n, bq, true)}>Hz</button>
          </span>
          {#if bw}
            <input class="num" data-k="w" onkeydown={tabAcross} value={bq.b} inputmode="numeric" aria-label="Bandbreite Band {tag(n)} in Hz"
              title="Bandbreite in Hz" onchange={(e) => num(e, n, "b", 1, [1, lim.bqB[1]])} />
          {:else}
            <input class="num" data-k="w" onkeydown={tabAcross} value={bq.q / 1000} inputmode="decimal" aria-label="Güte Band {tag(n)}"
              title="Güte (Q)" onchange={(e) => num(e, n, "q", 1000, lim.bqQ)} />
          {/if}
        </div>
      </div>
    {/each}
    <button class="add" onclick={() => add("band")} disabled={!free} title="EQ-Band hinzufügen"><span class="plus">+</span><span>Band</span></button>
  </div>
</section>

<style>
  .head { margin-bottom: 1rem; }
  .chans { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .75rem; }
  .chans button { display: inline-flex; align-items: center; gap: .45rem; padding: .35rem .7rem; color: var(--muted); }
  .chans button.on { background: color-mix(in srgb, var(--accent) 20%, transparent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--fg); }
  .chans .n { color: var(--faint); }
  .chans .bus { border-style: dashed; }
  .block { padding: .8rem 1rem; display: grid; gap: .5rem; min-width: 0; flex: none; }
  .blockhead { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .small { font-size: .78rem; }
  .plot { padding: .8rem 1rem .4rem; margin: .75rem 0; flex: none; }
  .plothead { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin-bottom: .3rem; }
  .plothead h3 { margin-right: auto; }
  .check { display: inline-flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; }
  .check input { accent-color: var(--accent); }

  /* filter cards wrap onto further rows; the band strips stay in one row and scroll sideways */
  .cards { display: flex; flex-wrap: wrap; gap: .5rem; align-items: stretch; }
  .strips { display: flex; gap: .4rem; overflow-x: auto; padding-bottom: .4rem; align-items: stretch; }
  .card, .strip { flex: none; display: flex; flex-direction: column; gap: .45rem; padding: .5rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
  .card.sel, .strip.sel { border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 9%, var(--raised)); }
  .card.off .knobs, .strip.off > :not(.striphead) { opacity: .5; }
  .cardhead, .striphead { display: flex; align-items: center; gap: .35rem; }
  .nr { min-width: 1.4rem; height: 1.4rem; display: grid; place-items: center; border-radius: 50%; border: 1.5px solid var(--accent); font-size: .75rem; font-weight: 650; }
  .sw { padding: .15rem .5rem; font-size: .75rem; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--accent); }
  .del { margin-left: auto; color: var(--muted); padding: .2rem; display: grid; }
  select { padding: .3rem .35rem; border-radius: 7px; border: 1px solid var(--line-strong); background: var(--panel); font-size: .82rem; text-overflow: ellipsis; width: 12.5rem; }
  select option, select optgroup { background: var(--bg); }
  .knobs { display: flex; gap: .2rem; justify-content: flex-start; min-height: 5.9rem; }
  .knobs :global(.knob) { width: 5rem !important; }
  .knobs :global(.knob .val input) { max-width: 3.6rem; }
  .card .del { margin-left: 0; }

  .strip { width: 4.5rem; padding: .4rem .3rem; gap: .35rem; }
  .strip .sw { width: 100%; padding: .12rem 0; }
  .strip .f input { width: 100%; min-width: 0; text-align: center; font-size: .85rem; padding: .22rem .15rem; }
  .strip .f > span:first-child { text-align: center; }
  .fader { display: grid; justify-items: center; }
  .f { display: grid; gap: .1rem; font-size: .68rem; color: var(--muted); }
  .mode { display: flex; border: 1px solid var(--line-strong); border-radius: 7px; overflow: hidden; margin-bottom: .15rem; }
  .mode button { flex: 1; border: 0; border-radius: 0; background: none; padding: .12rem 0; font-size: .7rem; color: var(--muted); }
  .mode button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--fg); }
  .add { flex: none; width: 3.6rem; min-height: 5rem; display: grid; place-content: center; justify-items: center; gap: .2rem; border-style: dashed; color: var(--muted); }
  .plus { font-size: 1.4rem; line-height: 1; }
</style>

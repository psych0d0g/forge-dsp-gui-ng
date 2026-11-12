<script lang="ts">
  import { tick, untrack } from "svelte";
  import { app, outName, write } from "../lib/app.svelte";
  import { isPort, limitsOf, sumsActiveAnywhere, type Biquad } from "../lib/device";
  import { isActive, typeInfo, TYPES } from "../lib/dsp/biquad";
  import ResponsePlot from "../components/ResponsePlot.svelte";
  import Icon from "../components/Icon.svelte";
  import VFader from "../components/VFader.svelte";

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
  // Filters line up by frequency. The order is only taken over when an interaction ends (pointer
  // released, field left, filter added or removed), so nothing moves away under the hand.
  let order = $state<number[]>([]);
  const byFreq = () => slots.filter((s) => s.bq.type !== 0).sort((a, b) => a.bq.f - b.bq.f || a.n - b.n).map((s) => s.n);
  async function resort() {
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
  });
  const used = $derived([
    ...order.map((n) => slots.find((s) => s.n === n)).filter((s): s is { n: number; bq: Biquad } => !!s && s.bq.type !== 0),
    ...slots.filter((s) => s.bq.type !== 0 && !order.includes(s.n)),  // just added, not sorted in yet
  ]);
  /** running number of a filter in this order (the slot number of the device is an internal detail) */
  const pos = (n: number) => used.findIndex((s) => s.n === n) + 1;
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
    resort();
  }
  function remove(n: number) {
    update(n, { type: 0, f: 0, gain: 0, q: 0, b: 0, flags: 0 });
    if (selected === n) selected = null;
    resort();
  }
  // The upright fader of a strip sets the gain; for types without gain (crossovers, all passes)
  // it sets the frequency on a logarithmic scale.
  const logFrac = (f: number) => (Math.log(clamp(f || lim.freq[0], lim.freq)) - Math.log(lim.freq[0])) / (Math.log(lim.freq[1]) - Math.log(lim.freq[0]));
  const faderFrac = (bq: Biquad) => (typeInfo(bq.type)?.gain ? (bq.gain - lim.bqGain[0]) / (lim.bqGain[1] - lim.bqGain[0]) : logFrac(bq.f));
  function faderSet(n: number, bq: Biquad, frac: number) {
    if (typeInfo(bq.type)?.gain) update(n, { gain: Math.round(lim.bqGain[0] + frac * (lim.bqGain[1] - lim.bqGain[0])) });
    else update(n, { f: Math.round(lim.freq[0] * Math.pow(lim.freq[1] / lim.freq[0], frac)) });
  }
  function faderStep(n: number, bq: Biquad, dir: number) {
    if (typeInfo(bq.type)?.gain) update(n, { gain: clamp(bq.gain + dir * 5, lim.bqGain) });        // 0.5 dB
    else update(n, { f: clamp(Math.round(bq.f * Math.pow(2, dir / 12)) || bq.f + dir, lim.freq) });   // 1/12 octave
  }
  const fmtF = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${f} Hz`);
  const fmtG = (g: number) => `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g / 10).toFixed(1)} dB`;

  // Tab in a value field goes to the same field of the next filter (Shift+Tab: previous), so a
  // row of frequencies or gains can be typed in one go. At the ends Tab leaves as usual.
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

  function num(e: Event, n: number, key: "f" | "gain" | "q" | "b", scale: number, range: [number, number]) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", "."));
    if (!Number.isNaN(v)) update(n, { [key]: clamp(Math.round(v * scale), range) });
    el.value = String(d.biquads[ch][n][key] / scale);
    resort();
  }
</script>

<svelte:window onpointerup={resort} />

<header class="head">
  <div>
    <h2>Filter & EQ</h2>
    <p class="muted">Weichen, Equalizer und Phasenfilter je Kanal. Punkte im Diagramm ziehen ändert Frequenz und Pegel, das
      Mausrad auf einem Punkt die Güte. In den Wertefeldern springt Tab zum gleichen Feld des nächsten Filters.</p>
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
  <ResponsePlot filters={used.map((s, i) => ({ ...s, label: i + 1 }))} {rate} freq={lim.freq} gainRange={lim.bqGain} {selected} {showPhase}
    onselect={(n) => (selected = n)}
    onmove={(n, f, g) => update(n, g === null ? { f } : { f, gain: g })}
    onq={(n, k) => update(n, { q: clamp(Math.round(d.biquads[ch][n].q * k), lim.bqQ) })} />
</section>

<section class="panel list">
  <div class="listhead">
    <h3>Filter <span class="muted num">{used.length} von {slots.length}</span></h3>
  </div>
  <div class="strips">
    {#each used as { n, bq } (n)}
      {@const t = typeInfo(bq.type)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="strip" class:sel={selected === n} class:off={!isActive(bq)} onpointerdown={() => (selected = n)} onfocusin={() => (selected = n)}>
        <div class="striphead">
          <span class="nr num">{pos(n)}</span>
          <button class="sw" class:on={isActive(bq)} aria-pressed={isActive(bq)} title="Filter ein/aus"
            onclick={() => update(n, { flags: bq.flags ^ 0x80 })}>{isActive(bq) ? "Ein" : "Aus"}</button>
          <button class="ghost del" title="Filter entfernen" aria-label="Filter {n} entfernen" onclick={() => remove(n)}><Icon name="close" size={14} /></button>
        </div>
        <select value={bq.type} aria-label="Typ Filter {pos(n)}" title={t?.name ?? ""} onchange={(e) => setType(n, Number(e.currentTarget.value))}>
          {#if !t}<option value={bq.type}>Typ {bq.type}</option>{/if}
          {#each groups as g}
            <optgroup label={g}>
              {#each TYPES.filter((x) => x.group === g) as x}
                <option value={x.type} disabled={x.port && !port}>{x.name}{x.port && !port ? " (nur Port-Firmware)" : ""}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <div class="fader">
          <VFader frac={faderFrac(bq)} zero={t?.gain ? -lim.bqGain[0] / (lim.bqGain[1] - lim.bqGain[0]) : null}
            label="{t?.gain ? 'Pegel' : 'Frequenz'} Filter {n}" valuetext={t?.gain ? fmtG(bq.gain) : fmtF(bq.f)}
            onfrac={(f) => faderSet(n, bq, f)} onstep={(dir) => faderStep(n, bq, dir)} />
          <span class="what">{t?.gain ? "Pegel" : "Frequenz"}</span>
        </div>
        <label class="f"><span>Frequenz</span><span class="in"><input class="num" data-k="f" onkeydown={tabAcross} value={bq.f} inputmode="numeric"
          onchange={(e) => num(e, n, "f", 1, lim.freq)} /><i>Hz</i></span></label>
        <label class="f" class:hidden={!t?.gain}><span>Pegel</span><span class="in"><input class="num" data-k="gain" onkeydown={tabAcross} value={bq.gain / 10} inputmode="decimal"
          disabled={!t?.gain} onchange={(e) => num(e, n, "gain", 10, lim.bqGain)} /><i>dB</i></span></label>
        <label class="f" class:hidden={!t?.q}><span>Güte</span><span class="in"><input class="num" data-k="q" onkeydown={tabAcross} value={bq.q / 1000} inputmode="decimal"
          disabled={!t?.q} onchange={(e) => num(e, n, "q", 1000, lim.bqQ)} /><i>Q</i></span></label>
        <label class="f" class:hidden={!t?.b}><span>{t?.b === "Winkel (°)" ? "Winkel" : "Bandbreite"}</span><span class="in"><input class="num" data-k="b" onkeydown={tabAcross}
          value={bq.b} inputmode="numeric" disabled={!t?.b}
          onchange={(e) => num(e, n, "b", 1, t?.b === "Winkel (°)" ? [1, 359] : lim.bqB)} /><i>{t?.b === "Winkel (°)" ? "°" : "Hz"}</i></span></label>
      </div>
    {/each}
    <button class="add" onclick={add} disabled={used.length >= slots.length} title="Filter hinzufügen">
      <span class="plus">+</span><span>Filter</span>
    </button>
  </div>
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
  .list { margin-top: .75rem; padding: .8rem 1rem; display: grid; gap: .5rem; min-width: 0; }
  .listhead { display: flex; justify-content: space-between; align-items: center; }
  /* upright filter strips side by side, scrolling sideways when there are many */
  .strips { display: flex; gap: .5rem; overflow-x: auto; padding-bottom: .5rem; align-items: stretch; }
  .strip { flex: none; width: 8.8rem; display: flex; flex-direction: column; gap: .45rem; padding: .5rem; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
  .strip.sel { border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 9%, var(--raised)); }
  .strip.off > :not(.striphead) { opacity: .5; }
  .striphead { display: flex; align-items: center; gap: .3rem; }
  .nr { width: 1.4rem; color: var(--muted); font-weight: 650; }
  .sw { padding: .15rem .5rem; font-size: .75rem; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--accent); }
  .del { margin-left: auto; color: var(--muted); padding: .2rem; display: grid; }
  select { width: 100%; padding: .3rem .35rem; border-radius: 7px; border: 1px solid var(--line-strong); background: var(--panel); font-size: .8rem; text-overflow: ellipsis; }
  select option, select optgroup { background: var(--bg); }
  .fader { display: grid; justify-items: center; gap: .1rem; }
  .what { font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  .f { display: grid; gap: .05rem; font-size: .68rem; color: var(--muted); }
  .f.hidden { visibility: hidden; }
  .in { display: flex; align-items: baseline; gap: .25rem; }
  .in input { width: 100%; min-width: 0; text-align: right; font-size: .88rem; padding: .25rem .4rem; }
  .in i { font-style: normal; font-size: .72rem; width: 1.1rem; flex: none; }
  .add { flex: none; width: 4.6rem; display: grid; place-content: center; justify-items: center; gap: .2rem; border-style: dashed; color: var(--muted); }
  .plus { font-size: 1.4rem; line-height: 1; }
</style>

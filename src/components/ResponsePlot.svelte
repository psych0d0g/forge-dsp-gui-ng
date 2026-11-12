<script lang="ts">
  // Frequency response of one channel: sum curve, the selected filter alone, optional phase.
  // Handles sit at frequency/gain of each filter and can be dragged; the wheel changes the Q.
  import type { Biquad } from "../lib/device";
  import { chainResponse, coeffs, isActive, logFreqs, typeInfo } from "../lib/dsp/biquad";

  let { filters, rate, freq, gainRange, selected, showPhase, onselect, onmove, onq }: {
    filters: { n: number; bq: Biquad; label?: number }[]; rate: number; freq: [number, number]; gainRange: [number, number];
    selected: number | null; showPhase: boolean; onselect: (n: number) => void;
    onmove: (n: number, f: number, gainTenths: number | null) => void; onq: (n: number, factor: number) => void;
  } = $props();

  const W = 1000, H = 270, L = 44, R = 44, T = 12, B = 26;
  const DB_MIN = -30, DB_MAX = 18;
  const lo = $derived(Math.max(10, freq[0])), hi = $derived(Math.min(rate / 2 - 1, freq[1]));
  const x = (f: number) => L + ((Math.log10(f) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - L - R);
  const y = (db: number) => T + ((DB_MAX - Math.max(DB_MIN, Math.min(DB_MAX, db))) / (DB_MAX - DB_MIN)) * (H - T - B);
  const yPhase = (deg: number) => T + ((180 - deg) / 360) * (H - T - B);
  const fAt = (px: number) => Math.pow(10, Math.log10(lo) + ((px - L) / (W - L - R)) * (Math.log10(hi) - Math.log10(lo)));
  const dbAt = (py: number) => DB_MAX - ((py - T) / (H - T - B)) * (DB_MAX - DB_MIN);

  const freqs = $derived(logFreqs(lo, hi, 260));
  const active = $derived(filters.filter((f) => isActive(f.bq)));
  const total = $derived(chainResponse(active.map((f) => coeffs(f.bq, rate)), freqs, rate));
  const sel = $derived(active.find((f) => f.n === selected));
  const single = $derived(sel ? chainResponse([coeffs(sel.bq, rate)], freqs, rate) : null);
  const line = (v: number[], fy: (v: number) => number) => v.map((d, i) => `${i ? "L" : "M"}${x(freqs[i]).toFixed(1)} ${fy(d).toFixed(1)}`).join("");
  // phase wraps at +-180: start a new stroke instead of drawing the jump
  const phasePath = $derived(total.phase.map((p, i) =>
    `${i === 0 || Math.abs(p - total.phase[i - 1]) > 180 ? "M" : "L"}${x(freqs[i]).toFixed(1)} ${yPhase(p).toFixed(1)}`).join(""));
  const area = $derived(single ? `${line(single.db, y)}L${x(hi).toFixed(1)} ${y(0).toFixed(1)}L${x(lo).toFixed(1)} ${y(0).toFixed(1)}Z` : "");

  const GRID_F = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const GRID_DB = [-30, -24, -18, -12, -6, 0, 6, 12, 18];
  const fmtF = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));
  const handleDb = (bq: Biquad) => (typeInfo(bq.type)?.gain ? bq.gain / 10 : 0);

  let svg: SVGSVGElement | undefined = $state();
  let dragging: number | null = null;
  function point(e: PointerEvent): [number, number] {
    const r = svg!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  function down(e: PointerEvent, n: number) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragging = n;
    onselect(n);
  }
  function move(e: PointerEvent, f: { n: number; bq: Biquad }) {
    if (dragging !== f.n) return;
    const [px, py] = point(e);
    const nf = Math.round(Math.max(freq[0], Math.min(freq[1], fAt(px))));
    const g = typeInfo(f.bq.type)?.gain ? Math.round(Math.max(gainRange[0], Math.min(gainRange[1], dbAt(py) * 10))) : null;
    onmove(f.n, nf, g);
  }
  function wheel(e: WheelEvent, f: { n: number; bq: Biquad }) {
    if (!typeInfo(f.bq.type)?.q) return;
    e.preventDefault();
    onq(f.n, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }
</script>

<svg bind:this={svg} viewBox="0 0 {W} {H}" role="img" aria-label="Frequenzgang des Kanals">
  {#each GRID_F as f}
    {#if f >= lo && f <= hi}
      <line class="grid" x1={x(f)} x2={x(f)} y1={T} y2={H - B} />
      <text class="axis" x={x(f)} y={H - 8} text-anchor="middle">{fmtF(f)}</text>
    {/if}
  {/each}
  {#each GRID_DB as db}
    <line class="grid" class:zero={db === 0} x1={L} x2={W - R} y1={y(db)} y2={y(db)} />
    <text class="axis" x={L - 6} y={y(db) + 4} text-anchor="end">{db > 0 ? `+${db}` : db}</text>
  {/each}
  {#if showPhase}
    {#each [-180, -90, 0, 90, 180] as p}<text class="axis ph" x={W - R + 6} y={yPhase(p) + 4}>{p}°</text>{/each}
    <path class="phase" d={phasePath} />
  {/if}
  {#if area}<path class="single" d={area} />{/if}
  <path class="total" d={line(total.db, y)} />
  {#each active as f}
    <g class="handle" class:sel={f.n === selected} transform="translate({x(f.bq.f)} {y(handleDb(f.bq))})">
      <circle r="11" role="slider" tabindex="0" aria-label="Filter {f.label ?? f.n}: {f.bq.f} Hz" aria-valuenow={f.bq.f}
        aria-valuemin={freq[0]} aria-valuemax={freq[1]}
        onpointerdown={(e) => down(e, f.n)} onpointermove={(e) => move(e, f)} onpointerup={() => (dragging = null)}
        onpointercancel={() => (dragging = null)} onwheel={(e) => wheel(e, f)} onfocus={() => onselect(f.n)} />
      <text y="4" text-anchor="middle">{f.label ?? f.n}</text>
    </g>
  {/each}
</svg>

<style>
  svg { width: 100%; height: auto; display: block; touch-action: none; user-select: none; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .grid.zero { stroke: var(--line-strong); }
  .axis { fill: var(--faint); font: 11px var(--mono); }
  .axis.ph { fill: var(--muted); }
  .total { fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-linejoin: round; }
  .single { fill: color-mix(in srgb, var(--accent) 18%, transparent); stroke: color-mix(in srgb, var(--accent) 55%, transparent); stroke-width: 1; }
  .phase { fill: none; stroke: var(--muted); stroke-width: 1.4; stroke-dasharray: 5 4; }
  .handle circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; cursor: grab; }
  .handle.sel circle { fill: var(--accent); }
  .handle text { font: 600 11px var(--sans); fill: var(--fg); pointer-events: none; }
  .handle.sel text { fill: var(--accent-ink); }
  .handle circle:focus-visible { outline: none; stroke: var(--fg); }
</style>

<script lang="ts">
  // Rotary control: drag up/down, wheel or arrow keys while focused, value editable below.
  let { value, min = 0, max = 100, step = 1, label, caption = "", unit = "", onchange }:
    { value: number; min?: number; max?: number; step?: number; label: string; caption?: string; unit?: string;
      onchange: (v: number) => void } = $props();

  const START = -135, SWEEP = 270, R = 20;
  const frac = $derived(max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0);
  const polar = (deg: number, r = R) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [28 + r * Math.cos(a), 28 + r * Math.sin(a)];
  };
  const arc = (from: number, to: number) => {
    const [x0, y0] = polar(from), [x1, y1] = polar(to);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const angle = $derived(START + SWEEP * frac);
  const tip = $derived(polar(angle, 13));

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const emit = (v: number) => { const c = clamp(v); if (c !== value) onchange(c); };

  let drag: { y: number; start: number } | null = null;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { y: e.clientY, start: value };
  }
  function move(e: PointerEvent) {
    if (drag) emit(drag.start + ((drag.y - e.clientY) / 140) * (max - min));
  }
  function key(e: KeyboardEvent) {
    const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 10 * step, PageDown: -10 * step }[e.key];
    if (d !== undefined) { e.preventDefault(); emit(value + d); }
    else if (e.key === "Home") { e.preventDefault(); emit(min); }
    else if (e.key === "End") { e.preventDefault(); emit(max); }
  }
  function wheel(e: WheelEvent) {
    if (document.activeElement !== e.currentTarget) return;  // only the focused knob, the page stays scrollable
    e.preventDefault();
    emit(value + (e.deltaY < 0 ? 5 : -5) * step);
  }
  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", "."));
    if (!Number.isNaN(v)) emit(v);
    el.value = String(value);
  }
</script>

<div class="knob" class:zero={value <= min}>
  {#if caption}<span class="cap" title={caption}>{caption}</span>{/if}
  <svg viewBox="0 0 56 56" width="56" height="56" role="slider" tabindex="0" aria-label={label} aria-valuemin={min}
    aria-valuemax={max} aria-valuenow={value} onpointerdown={down} onpointermove={move} onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)} onkeydown={key} onwheel={wheel} ondblclick={() => emit(value > min ? min : max)}>
    <path class="rail" d={arc(START, START + SWEEP)} />
    {#if frac > 0}<path class="fill" d={arc(START, angle)} />{/if}
    <circle class="cap-c" cx="28" cy="28" r="14" />
    <line class="tick" x1="28" y1="28" x2={tip[0]} y2={tip[1]} />
  </svg>
  <label class="val num"><input value={String(value)} inputmode="numeric" aria-label="{label}, Wert" onchange={typed} />{#if unit}<span>{unit}</span>{/if}</label>
</div>

<style>
  .knob { display: grid; justify-items: center; gap: .15rem; width: 4.25rem; }
  .cap { font-size: .74rem; color: var(--muted); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  svg { touch-action: none; cursor: ns-resize; border-radius: 50%; }
  svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .rail, .fill { fill: none; stroke-width: 4; stroke-linecap: round; }
  .rail { stroke: var(--line-strong); }
  .fill { stroke: var(--accent); }
  .cap-c { fill: var(--raised); stroke: var(--line-strong); }
  .tick { stroke: var(--fg); stroke-width: 2; stroke-linecap: round; }
  .zero .tick { stroke: var(--faint); }
  .val { display: flex; align-items: baseline; gap: .15rem; font-size: .75rem; color: var(--muted); }
  .val input { width: 2.6rem; text-align: center; border: 1px solid transparent; background: none; padding: .1rem .15rem; border-radius: 6px;
    font: inherit; font-size: .9rem; color: var(--fg); }
  .zero .val input:not(:focus) { color: var(--faint); }
  .val input:hover { border-color: var(--line-strong); }
  .val input:focus { border-color: var(--accent); outline: none; background: var(--raised); }
</style>

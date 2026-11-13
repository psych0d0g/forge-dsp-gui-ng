<script lang="ts">
  // Fader working on a fraction 0..1 (bottom..top, or left..right with horizontal); the parent maps it
  // to its value. Upright on the pages, horizontal in the top bar (master).
  let { frac, zero = null, label, valuetext, disabled = false, horizontal = false, onfrac, onstep }: {
    frac: number; zero?: number | null; label: string; valuetext: string; disabled?: boolean; horizontal?: boolean;
    onfrac: (f: number) => void; onstep: (dir: number) => void;
  } = $props();

  let track: HTMLDivElement | undefined = $state();
  let dragging = false;
  const f = $derived(Math.max(0, Math.min(1, frac)));
  function at(e: PointerEvent) {
    const r = track!.getBoundingClientRect();
    const v = horizontal ? (e.clientX - r.left - 9) / (r.width - 18) : 1 - (e.clientY - r.top - 9) / (r.height - 18);
    onfrac(Math.max(0, Math.min(1, v)));
  }
  function down(e: PointerEvent) {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    at(e);
  }
  function key(e: KeyboardEvent) {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d !== undefined && !disabled) { e.preventDefault(); onstep(d); }
  }
  function wheel(e: WheelEvent) {
    if (disabled || document.activeElement !== e.currentTarget) return;
    e.preventDefault();
    onstep(e.deltaY < 0 ? 1 : -1);
  }
</script>

<div class="vf" class:h={horizontal} class:disabled bind:this={track} role="slider" tabindex={disabled ? -1 : 0} aria-orientation={horizontal ? "horizontal" : "vertical"}
  aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} aria-valuetext={valuetext}
  onpointerdown={down} onpointermove={(e) => { if (dragging) at(e); }} onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)} onkeydown={key} onwheel={wheel}
  style="--f:{f}; --z:{zero ?? 0}">
  <span class="rail"></span>
  {#if zero !== null}<span class="zero"></span>{/if}
  <span class="fill" class:from-zero={zero !== null}></span>
  <span class="thumb"></span>
</div>

<style>
  .vf { position: relative; width: 2.4rem; height: 8rem; touch-action: none; cursor: ns-resize; border-radius: 8px; --pad: 9px; }
  .vf.disabled { opacity: .35; cursor: default; }
  .vf:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .rail { position: absolute; left: 50%; top: var(--pad); bottom: var(--pad); width: 4px; margin-left: -2px; border-radius: 2px; background: var(--line-strong); }
  /* y of a fraction: pad + (1 - f) * (height - 2 pad) */
  .fill { position: absolute; left: 50%; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--accent);
    bottom: var(--pad); height: calc(var(--f) * (100% - 2 * var(--pad))); }
  .fill.from-zero { bottom: calc(var(--pad) + min(var(--f), var(--z)) * (100% - 2 * var(--pad)));
    height: calc(max(var(--f) - var(--z), var(--z) - var(--f)) * (100% - 2 * var(--pad))); }
  .zero { position: absolute; left: 20%; right: 20%; height: 1px; background: var(--faint); bottom: calc(var(--pad) + var(--z) * (100% - 2 * var(--pad))); }
  .thumb { position: absolute; left: 50%; width: 1.7rem; height: 14px; margin-left: -.85rem; border-radius: 4px; background: var(--fg);
    border: 1px solid rgba(0, 0, 0, .35); box-shadow: 0 1px 3px rgba(0, 0, 0, .4);
    bottom: calc(var(--pad) - 7px + var(--f) * (100% - 2 * var(--pad))); }
  .thumb::after { content: ""; position: absolute; left: 3px; right: 3px; top: 6px; height: 1px; background: rgba(0, 0, 0, .45); }
  /* horizontal: the same parts turned by 90 degrees, x of a fraction: pad + f * (width - 2 pad) */
  .vf.h { width: 9.5rem; height: 1.9rem; cursor: ew-resize; }
  .h .rail { left: var(--pad); right: var(--pad); top: 50%; bottom: auto; width: auto; height: 4px; margin: -2px 0 0; }
  .h .fill { left: var(--pad); top: 50%; bottom: auto; height: 4px; margin: -2px 0 0; width: calc(var(--f) * (100% - 2 * var(--pad))); }
  .h .fill.from-zero { left: calc(var(--pad) + min(var(--f), var(--z)) * (100% - 2 * var(--pad))); bottom: auto;
    height: 4px; width: calc(max(var(--f) - var(--z), var(--z) - var(--f)) * (100% - 2 * var(--pad))); }
  .h .zero { top: 20%; bottom: 20%; left: calc(var(--pad) + var(--z) * (100% - 2 * var(--pad))); right: auto; width: 1px; height: auto; }
  .h .thumb { top: 50%; bottom: auto; width: 14px; height: 1.35rem; margin: -.675rem 0 0;
    left: calc(var(--pad) - 7px + var(--f) * (100% - 2 * var(--pad))); }
  .h .thumb::after { left: 6px; right: auto; top: 3px; bottom: 3px; width: 1px; height: auto; }
</style>

<script lang="ts">
  // Plain horizontal slider in the look of the faders.
  let { value, min = 0, max, step = 1, label, disabled = false, onchange }:
    { value: number; min?: number; max: number; step?: number; label: string; disabled?: boolean; onchange: (v: number) => void } = $props();
  const pct = $derived(max > min ? ((Math.min(value, max) - min) / (max - min)) * 100 : 0);
</script>

<div class="track" style="--pct:{pct}%">
  <input type="range" {min} {max} {step} {value} {disabled} aria-label={label}
    oninput={(e) => onchange(Number(e.currentTarget.value))} />
</div>

<style>
  .track { position: relative; flex: 1; min-width: 6rem; height: 1.6rem; display: flex; align-items: center; }
  .track::before { content: ""; position: absolute; inset: 50% 0 auto 0; height: 4px; margin-top: -2px; border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--pct), var(--line-strong) var(--pct)); }
  input { position: relative; z-index: 1; width: 100%; margin: 0; background: none; -webkit-appearance: none; appearance: none; height: 1.6rem; cursor: pointer; }
  input::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 20px; border-radius: 4px; background: var(--fg);
    border: 1px solid rgba(0, 0, 0, .35); box-shadow: 0 1px 3px rgba(0, 0, 0, .4); }
  input::-moz-range-thumb { width: 12px; height: 18px; border-radius: 4px; background: var(--fg); border: 1px solid rgba(0, 0, 0, .35); }
  input::-moz-range-track { background: none; }
</style>

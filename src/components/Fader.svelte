<script lang="ts">
  import { dbToRaw, rawToDb, type GainScale } from "../lib/device";

  let { value, scale, dim = false, label, onchange }:
    { value: number; scale: GainScale; dim?: boolean; label: string; onchange: (raw: number) => void } = $props();

  const db = $derived(rawToDb(scale, value));
  const pct = $derived(((value - scale.min) / (scale.max - scale.min)) * 100);
  const zeroPct = $derived(((scale.zero - scale.min) / (scale.max - scale.min)) * 100);
  const text = $derived(value <= scale.min ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));

  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", ".").replace("−", "-"));
    if (!Number.isNaN(v)) onchange(dbToRaw(scale, v));
    el.value = text;
  }
</script>

<div class="fader" class:dim>
  <div class="track" style="--pct:{pct}%; --zero:{zeroPct}%">
    <input type="range" min={scale.min} max={scale.max} step="1" {value} aria-label={label}
      oninput={(e) => onchange(Number(e.currentTarget.value))}
      ondblclick={() => onchange(scale.zero)} />
  </div>
  <label class="readout num"><input value={text} onchange={typed} aria-label="{label} in dB" /><span>dB</span></label>
</div>

<style>
  .fader { display: flex; align-items: center; gap: .75rem; min-width: 0; flex: 1; }
  .fader.dim { opacity: .5; }
  .track { position: relative; flex: 1; min-width: 6rem; height: 1.6rem; display: flex; align-items: center; }
  /* rail with the filled part and a tick at 0 dB */
  .track::before { content: ""; position: absolute; inset: 50% 0 auto 0; height: 4px; margin-top: -2px; border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--pct), var(--line-strong) var(--pct)); }
  .track::after { content: ""; position: absolute; left: var(--zero); top: 3px; bottom: 3px; width: 1px; background: var(--faint); }
  input[type="range"] { position: relative; z-index: 1; width: 100%; margin: 0; background: none; -webkit-appearance: none; appearance: none; height: 1.6rem; cursor: pointer; }
  input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 20px; border-radius: 4px; background: var(--fg);
    border: 1px solid rgba(0, 0, 0, .35); box-shadow: 0 1px 3px rgba(0, 0, 0, .4); }
  input[type="range"]::-moz-range-thumb { width: 12px; height: 18px; border-radius: 4px; background: var(--fg); border: 1px solid rgba(0, 0, 0, .35); }
  input[type="range"]::-moz-range-track { background: none; }
  .readout { display: flex; align-items: baseline; gap: .25rem; width: 5.6rem; justify-content: flex-end; color: var(--muted); font-size: .8rem; }
  .readout input { width: 3.6rem; text-align: right; border: 1px solid transparent; background: none; padding: .15rem .25rem; border-radius: 6px;
    font: inherit; font-size: .95rem; color: var(--fg); }
  .readout input:hover { border-color: var(--line-strong); }
</style>

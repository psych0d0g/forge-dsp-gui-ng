<script lang="ts">
  // Upright level fader with the dB value in an editable field below.
  import { dbToRaw, rawToDb, type GainScale } from "../lib/device";
  import VFader from "./VFader.svelte";

  let { value, scale, label, dim = false, onchange }:
    { value: number; scale: GainScale; label: string; dim?: boolean; onchange: (raw: number) => void } = $props();

  const span = $derived(scale.max - scale.min);
  const db = $derived(rawToDb(scale, value));
  const text = $derived(value <= scale.min ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));
  const clamp = (v: number) => Math.min(scale.max, Math.max(scale.min, Math.round(v)));
  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value.replace(",", ".").replace("−", "-"));
    if (!Number.isNaN(v)) onchange(dbToRaw(scale, v));
    el.value = text;
  }
</script>

<div class="dbf" class:dim>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div ondblclick={() => onchange(scale.zero)}>
    <VFader frac={(value - scale.min) / span} zero={(scale.zero - scale.min) / span} {label} valuetext="{text} dB"
      onfrac={(f) => onchange(clamp(scale.min + f * span))} onstep={(d) => onchange(clamp(value + d))} />
  </div>
  <label class="num"><input value={text} onchange={typed} aria-label="{label} in dB" /><span>dB</span></label>
</div>

<style>
  .dbf { display: grid; justify-items: center; gap: .2rem; }
  .dbf.dim { opacity: .5; }
  .dbf label { display: flex; align-items: baseline; gap: .05rem; font-size: .7rem; color: var(--muted); }
  .dbf input { width: 3.1rem; text-align: center; border: 1px solid transparent; background: none; padding: .1rem .1rem; border-radius: 6px;
    font: inherit; font-size: .85rem; color: var(--fg); }
  .dbf input:hover { border-color: var(--line-strong); }
  .dbf input:focus { border-color: var(--accent); outline: none; background: var(--raised); }
</style>

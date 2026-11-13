<script lang="ts">
  import { untrack } from "svelte";
  import { meter } from "../lib/app.svelte";
  import { vuToDb } from "../lib/device";

  // One level bar (RMS, dBFS) from a system.vu / system.vu.out value: rises at once, falls slowly.
  // floor: where the bar starts (setting "Anzeige ab", app.svelte.ts); number: dBFS next to the bar
  let { value, label = "", number = false }: { value: number | undefined; label?: string; number?: boolean } = $props();
  const FALL_DB = 3;
  const floor = $derived(meter.floor);
  let shown = $state(-200);
  $effect(() => {
    const now = vuToDb(value ?? 0);
    const prev = untrack(() => shown);
    shown = Math.max(now, prev - FALL_DB, -200);
  });
  const pct = $derived(`${Math.max(0, Math.min(100, ((shown - floor) / -floor) * 100))}%`);
  const text = $derived(shown <= -200 ? "−∞" : `${shown.toFixed(0)}`);
</script>

<div class="wrap">
  <div class="lb" title="{label ? label + ': ' : ''}{text} dBFS" role="meter" aria-label="Pegel {label}"
    aria-valuemin={floor} aria-valuemax={0} aria-valuenow={Math.max(floor, Math.round(shown))}>
    <div class="fill" style="width:{pct}"></div>
  </div>
  {#if number}<span class="db num" class:low={shown < floor}>{text}</span>{/if}
</div>

<style>
  .wrap { display: flex; align-items: center; gap: .4rem; width: 100%; }
  .db { font-size: .68rem; color: var(--muted); min-width: 2.2rem; text-align: right; }
  .db.low { color: var(--faint); }
  .lb { height: 4px; border-radius: 2px; background: var(--line-strong); overflow: hidden; width: 100%; container-type: inline-size; }
  /* the gradient spans the whole rail, the fill reveals it: accent up to -12 dBFS, amber, red at the top */
  .fill { height: 100%; border-radius: 2px; transition: width .18s linear;
    background: linear-gradient(to right, var(--accent) 0, var(--accent) 80%, var(--warn) 80%, var(--warn) 95%, var(--err) 95%);
    background-size: 100cqw 100%; }
</style>

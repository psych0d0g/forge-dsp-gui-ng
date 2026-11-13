<script lang="ts">
  import { untrack } from "svelte";
  import { vuToDb } from "../lib/device";

  // One level bar (RMS, dBFS) from a system.vu / system.vu.out value: rises at once, falls slowly.
  let { value, label = "" }: { value: number | undefined; label?: string } = $props();
  const FLOOR = -60;
  const FALL_DB = 3;
  let shown = $state(FLOOR);
  $effect(() => {
    const now = Math.max(FLOOR, vuToDb(value ?? 0));
    const prev = untrack(() => shown);
    shown = Math.max(now, prev - FALL_DB);
  });
  const pct = $derived(`${Math.max(0, Math.min(100, ((shown - FLOOR) / -FLOOR) * 100))}%`);
  const text = $derived(shown <= FLOOR ? "−∞ dBFS" : `${shown.toFixed(0)} dBFS`);
</script>

<div class="lb" title="{label ? label + ': ' : ''}{text}" role="meter" aria-label="Pegel {label}"
  aria-valuemin={FLOOR} aria-valuemax={0} aria-valuenow={Math.round(shown)}>
  <div class="fill" style="width:{pct}"></div>
</div>

<style>
  .lb { height: 4px; border-radius: 2px; background: var(--line-strong); overflow: hidden; width: 100%; container-type: inline-size; }
  /* the gradient spans the whole rail, the fill reveals it: accent up to -12 dBFS, amber, red at the top */
  .fill { height: 100%; border-radius: 2px; transition: width .18s linear;
    background: linear-gradient(to right, var(--accent) 0, var(--accent) 80%, var(--warn) 80%, var(--warn) 95%, var(--err) 95%);
    background-size: 100cqw 100%; }
</style>

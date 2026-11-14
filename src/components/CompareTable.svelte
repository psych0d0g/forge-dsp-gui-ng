<script lang="ts">
  // What differs between two tunings (#24), grouped like the pages of the interface.
  import { t } from "../lib/i18n/index.svelte";
  import { COMPARE_GROUP_NAME, COMPARE_GROUPS, type CompareRow } from "../lib/device";

  let { title, a, b, rows, onclose }: { title: string; a: string; b: string; rows: CompareRow[]; onclose?: () => void } = $props();
  const groups = $derived(COMPARE_GROUPS.map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length));
</script>

<div class="compare" data-testid="compare">
  <div class="top">
    <strong>{title}</strong>
    <span class="muted">{rows.length === 1 ? t("compare.oneDifference") : rows.length ? t("compare.nDifferences", { n: rows.length }) : t("compare.same")}</span>
    {#if onclose}<button class="ghost close" onclick={onclose}>{t("compare.close")}</button>{/if}
  </div>
  {#each groups as x (x.g)}
    <details open={x.rows.length <= 40}>
      <summary>{t(COMPARE_GROUP_NAME[x.g])} <span class="muted num">{x.rows.length}</span></summary>
      <div class="grid" role="table">
        <div class="row head" role="row"><span role="columnheader">{t("compare.setting")}</span><span role="columnheader">{a}</span><span role="columnheader">{b}</span></div>
        {#each x.rows as r (r.reg)}
          <div class="row" role="row" title={r.reg}><span role="cell">{r.label}</span><span role="cell" class="num">{r.a}</span><span role="cell" class="num">{r.b}</span></div>
        {/each}
      </div>
    </details>
  {/each}
</div>

<style>
  .compare { display: grid; gap: .5rem; border-top: 1px solid var(--line); padding-top: .7rem; }
  .top { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .close { margin-left: auto; }
  details { border: 1px solid var(--line); border-radius: 8px; padding: .35rem .6rem; }
  summary { cursor: pointer; font-weight: 600; }
  .grid { display: grid; margin-top: .35rem; }
  .row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); gap: .6rem; padding: .22rem 0;
    border-top: 1px solid var(--line); font-size: .88rem; }
  .row span { overflow-wrap: anywhere; }
  .row.head { border-top: 0; color: var(--muted); font-size: .8rem; }
</style>

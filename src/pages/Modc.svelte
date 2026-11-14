<script lang="ts">
  import { t, tx } from "../lib/i18n/index.svelte";
  import { app, sendModc } from "../lib/app.svelte";
  import { availableTypes, copyModc, emptyModc, eventOptions, modcName, modcText, modcType, type Modc } from "../lib/device";
  import Icon from "../components/Icon.svelte";
  import ModcFields from "../components/ModcFields.svelte";

  const d = $derived(app.device);
  const total = $derived(d.identity.modcBlocks || 32);
  const used = $derived(Object.keys(d.modc).map(Number).filter((n) => d.modc[n].type !== 0).sort((a, b) => a - b));
  const types = $derived(availableTypes(d));
  const events = $derived(eventOptions(total));
  let sel = $state<number | null>(null);
  $effect(() => {
    if (sel !== null || !used.length) return;
    const want = Number(new URLSearchParams(location.search).get("block"));  // ?block=N opens that block
    sel = used.includes(want) ? want : used[0];
  });
  let raw = $state(false);
  let err = $state("");
  const m = $derived(sel !== null ? d.modc[sel] : undefined);
  const mt = $derived(m ? modcType(m.type) : undefined);

  // the last block (start-up/shutdown delays) is fixed: its type and enable stay
  const fixed = (n: number | null) => n === total;
  async function send(n: number, before: Modc) {
    err = await sendModc(n, before);
  }
  function change(fn: (b: Modc) => void) {
    if (sel === null || !d.modc[sel]) return;
    const before = copyModc(d.modc[sel]);
    fn(d.modc[sel]);
    send(sel, before);
  }
  const byte = (e: Event) => Math.max(0, Math.min(255, Math.round(Number((e.currentTarget as HTMLInputElement).value)) || 0));
  function add() {
    const free = Array.from({ length: total }, (_, i) => i + 1).find((n) => !d.modc[n] || d.modc[n].type === 0);
    if (!free || !types.length) return;
    const before = copyModc(d.modc[free] ?? emptyModc());
    d.modc[free] = { ...emptyModc(), type: types[0].type };  // disabled until it is set up
    sel = free;
    send(free, before);
  }
  function remove(n: number) {
    if (!confirm(t("modc.removeBlockNName", { n, name: modcName(d.modc[n].type) }))) return;
    const before = copyModc(d.modc[n]);
    d.modc[n] = emptyModc();
    send(n, before);
    if (sel === n) sel = used.find((x) => x !== n) ?? null;
  }
  function setType(type: number) {
    if (sel === null) return;
    const before = copyModc(d.modc[sel]);
    d.modc[sel] = { ...emptyModc(), type };  // the fields of another type mean something else
    send(sel, before);
  }
</script>

<header class="head">
  <div>
    <h2>{t("common.controlBlocks")}</h2>
    <p class="muted">{t("modc.blocksLinkEventsButtons")}
      {t("modc.nMUse", { n: used.length, m: total })}</p>
  </div>
  <button onclick={add} disabled={used.length >= total}>{t("modc.block")}</button>
</header>

{#if err}<div class="panel alert" role="alert">{t("modc.refusedByDeviceErr", { err })}</div>{/if}

<div class="layout">
  <section class="panel list" aria-label={t("modc.blocks")}>
    {#each used as n}
      {@const b = d.modc[n]}
      <button class="item" class:on={sel === n} aria-pressed={sel === n} onclick={() => (sel = n)}>
        <span class="nr num">{n}</span>
        <span class="nm">{modcName(b.type)}</span>
        <span class="dot" class:ok={!!b.enable} title={b.enable ? t("common.active") : t("common.off")}></span>
      </button>
    {/each}
    {#if !used.length}<p class="muted pad">{t("modc.noBlocksYet")}</p>{/if}
  </section>

  {#if m && sel !== null}
    <section class="panel edit">
      <div class="edithead">
        <span class="big num">{sel}</span>
        <select value={m.type} aria-label={t("modc.type")} disabled={fixed(sel)} onchange={(e) => setType(Number(e.currentTarget.value))}>
          {#if !types.some((x) => x.type === m.type)}<option value={m.type}>{modcName(m.type)}</option>{/if}
          {#each types as x}<option value={x.type}>{tx(x.name)}</option>{/each}
        </select>
        <button class="sw" class:on={!!m.enable} aria-pressed={!!m.enable} disabled={fixed(sel)} onclick={() => change((b) => (b.enable = b.enable ? 0 : 1))}>
          {m.enable ? t("modc.active2") : t("common.off2")}</button>
        <button class="ghost del" disabled={fixed(sel)} title={t("modc.removeBlock")} aria-label={t("modc.removeBlock")} onclick={() => remove(sel!)}><Icon name="close" size={16} /></button>
      </div>
      {#if mt}<p class="muted">{tx(mt.help)}</p>{:else}<p class="muted">{t("modc.fieldsTypeNotDescribed")}</p>{/if}
      <p class="muted small">{t("modc.blockOutputsItsResult", { n: 96 + sel })}</p>

      {#if mt?.fields && !raw}
        <ModcFields {m} fields={mt.fields} {events} {change} />
      {:else}
        {#each [["events", t("common.event")], ["sets", "Set"], ["flags", "Flag"]] as const as [of, name]}
          <div class="group">
            <h3>{of === "events" ? t("modc.events") : of === "sets" ? t("modc.valuesSets") : "Flags"}</h3>
            <div class="fields">
              {#each m[of] as v, i}
                <label class="fld"><span>{name} {i + 1}</span>
                  <input class="num short" value={v} inputmode="numeric" onchange={(e) => change((b) => (b[of][i] = byte(e)))} /></label>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

      <div class="foot">
        <label class="check"><input type="checkbox" bind:checked={raw} disabled={!mt?.fields} /> {t("modc.showRawValuesEvents")}</label>
        <code class="num">modc.{sel}={modcText(m)}</code>
      </div>
    </section>
  {:else}
    <section class="panel edit hint"><p class="muted">{t("modc.chooseBlockLeftOr")}</p></section>
  {/if}
</div>

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  .alert { padding: .5rem 1rem; margin-bottom: .75rem; border-color: var(--err); color: var(--err); }
  .layout { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: .75rem; align-items: start; }
  .list { padding: .4rem; display: grid; gap: 2px; }
  .item { display: flex; align-items: center; gap: .6rem; padding: .45rem .55rem; border: 1px solid transparent; background: none; border-radius: 8px; text-align: left; }
  .item.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .nr { width: 1.6rem; color: var(--faint); text-align: right; }
  .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pad { padding: .6rem; }
  .edit { padding: 1rem; display: grid; gap: .8rem; }
  .edithead { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .big { width: 2.4rem; height: 2.4rem; display: grid; place-items: center; border-radius: 10px; background: var(--raised); font-size: 1.1rem; font-weight: 650; }
  select { padding: .4rem .5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); min-width: 0; }
  select option { background: var(--bg); }
  .edithead select { font-weight: 600; flex: 1 1 12rem; max-width: 20rem; }
  .sw { min-width: 4rem; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--ok) 20%, transparent); border-color: var(--ok); color: var(--ok); }
  .del { margin-left: auto; color: var(--muted); }
  .small { font-size: .8rem; }
  .group { display: grid; gap: .45rem; border-top: 1px solid var(--line); padding-top: .7rem; }
  .check { display: inline-flex; align-items: center; gap: .4rem; }
  .check input { accent-color: var(--accent); }
  .fields { display: grid; gap: .6rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); align-items: end; }
  .fld { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); }
  .fld input { font-size: .9rem; }
  .short { width: 6rem; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: .7rem; color: var(--muted); }
  code { font-size: .8rem; overflow-wrap: anywhere; }
  .hint { min-height: 8rem; place-content: center; }
  @media (max-width: 56rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
</style>

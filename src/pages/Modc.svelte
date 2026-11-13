<script lang="ts">
  import { t, tx } from "../lib/i18n/index.svelte";
  import { app, writeRaw } from "../lib/app.svelte";
  import { availableTypes, choiceGet, choiceSet, emptyModc, eventOptions, modcName, modcText, modcType, wordGet, wordSet, type Field, type Modc } from "../lib/device";
  import Icon from "../components/Icon.svelte";

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

  async function send(n: number) {
    err = await writeRaw(`modc.${n}`, modcText(d.modc[n]));
  }
  function change(fn: (b: Modc) => void) {
    if (sel === null || !d.modc[sel]) return;
    fn(d.modc[sel]);
    send(sel);
  }
  const byte = (e: Event) => Math.max(0, Math.min(255, Math.round(Number((e.currentTarget as HTMLInputElement).value)) || 0));
  function add() {
    const free = Array.from({ length: total }, (_, i) => i + 1).find((n) => !d.modc[n] || d.modc[n].type === 0);
    if (!free || !types.length) return;
    d.modc[free] = { ...emptyModc(), type: types[0].type };  // disabled until it is set up
    sel = free;
    send(free);
  }
  function remove(n: number) {
    if (!confirm(t("modc.removeBlockNName", { n, name: modcName(d.modc[n].type) }))) return;
    d.modc[n] = emptyModc();
    send(n);
    if (sel === n) sel = used.find((x) => x !== n) ?? null;
  }
  function setType(type: number) {
    if (sel === null) return;
    d.modc[sel] = { ...emptyModc(), type };  // the fields of another type mean something else
    send(sel);
  }
  // typed fields of the dialog
  const dec = (n: number) => String(+n.toFixed(2)).replace(".", ",");
  const numOf = (e: Event) => Number((e.currentTarget as HTMLInputElement).value.replace(",", "."));
  function setByte(f: Extract<Field, { kind: "byte" }>, e: Event) {
    const v = numOf(e);
    if (!Number.isNaN(v)) change((b) => (b[f.of][f.i - 1] = Math.max(0, Math.min(255, Math.round(v / (f.mul ?? 1))))));
    (e.currentTarget as HTMLInputElement).value = dec(m![f.of][f.i - 1] * (f.mul ?? 1));
  }
  function setWord(f: Extract<Field, { kind: "word" }>, e: Event) {
    const div = f.div ?? 1, lo = f.min ?? (f.signed ? -32768 / div : 0), hi = f.max ?? (f.signed ? 32767 : 65535) / div;
    const v = numOf(e);
    if (!Number.isNaN(v)) change((b) => wordSet(b.sets, f.i, Math.max(lo, Math.min(hi, v)) * div));
    (e.currentTarget as HTMLInputElement).value = dec(wordGet(m!.sets, f.i, f.signed) / div);
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
        <select value={m.type} aria-label={t("modc.type")} onchange={(e) => setType(Number(e.currentTarget.value))}>
          {#if !types.some((x) => x.type === m.type)}<option value={m.type}>{modcName(m.type)}</option>{/if}
          {#each types as x}<option value={x.type}>{tx(x.name)}</option>{/each}
        </select>
        <button class="sw" class:on={!!m.enable} aria-pressed={!!m.enable} onclick={() => change((b) => (b.enable = b.enable ? 0 : 1))}>
          {m.enable ? t("modc.active2") : t("common.off2")}</button>
        <button class="ghost del" title={t("modc.removeBlock")} aria-label={t("modc.removeBlock")} onclick={() => remove(sel!)}><Icon name="close" size={16} /></button>
      </div>
      {#if mt}<p class="muted">{tx(mt.help)}</p>{:else}<p class="muted">{t("modc.fieldsTypeNotDescribed")}</p>{/if}
      <p class="muted small">{t("modc.blockOutputsItsResult", { n: 96 + sel })}</p>

      {#if mt?.fields && !raw}
        <div class="fields typed">
          {#each mt.fields as f}
            {#if f.kind === "event"}
              {@const ev = m.events[f.i - 1]}
              <label class="fld"><span>{tx(f.label)}</span>
                <span class="evt">
                  <input class="num" value={ev} inputmode="numeric" onchange={(e) => change((b) => (b.events[f.i - 1] = byte(e)))} />
                  <select value={events.some((o) => o.value === ev) ? ev : -1} aria-label="{tx(f.label)}: {t("modc.chooseEvent")}"
                    onchange={(e) => change((b) => (b.events[f.i - 1] = Number(e.currentTarget.value)))}>
                    {#if !events.some((o) => o.value === ev)}<option value={-1}>{t("modc.ownValue")}</option>{/if}
                    {#each events as o}<option value={o.value}>{o.label}</option>{/each}
                  </select>
                </span></label>
            {:else if f.kind === "byte"}
              <label class="fld"><span>{tx(f.label)}</span>
                <span class="unit"><input class="num short" value={dec(m[f.of][f.i - 1] * (f.mul ?? 1))} inputmode="decimal" onchange={(e) => setByte(f, e)} />
                  {#if f.unit}<i>{f.unit}</i>{/if}{#if f.hint}<em>{tx(f.hint)}</em>{/if}</span></label>
            {:else if f.kind === "word"}
              <label class="fld"><span>{tx(f.label)}</span>
                <span class="unit"><input class="num short" value={dec(wordGet(m.sets, f.i, f.signed) / (f.div ?? 1))} inputmode="decimal" onchange={(e) => setWord(f, e)} />
                  {#if f.unit}<i>{f.unit}</i>{/if}{#if f.hint}<em>{tx(f.hint)}</em>{/if}</span></label>
            {:else if f.kind === "choice"}
              {@const cur = choiceGet(m[f.of][f.i - 1], f) - (f.first ?? 0)}
              <label class="fld"><span>{tx(f.label)}</span>
                <select value={cur} onchange={(e) => change((b) => (b[f.of][f.i - 1] = choiceSet(b[f.of][f.i - 1], f, Number(e.currentTarget.value) + (f.first ?? 0))))}>
                  {#if cur < 0 || cur >= f.options.length}<option value={cur}>{t("modc.valueN", { n: choiceGet(m[f.of][f.i - 1], f) })}</option>{/if}
                  {#each f.options as o, k}<option value={k}>{tx(o)}</option>{/each}
                </select></label>
            {:else if f.kind === "bits"}
              <div class="fld wide"><span>{tx(f.label)}</span>
                <div class="bits">
                  {#each f.bits as l, bit}
                    {#if l}
                      <label class="check"><input type="checkbox" checked={!!(m[f.of][f.i - 1] & (1 << bit))}
                        onchange={() => change((b) => (b[f.of][f.i - 1] ^= 1 << bit))} /> {tx(l)}</label>
                    {/if}
                  {/each}
                </div></div>
            {/if}
          {/each}
        </div>
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
  .bits { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; }
  .check { display: inline-flex; align-items: center; gap: .4rem; }
  .check input { accent-color: var(--accent); }
  .fields { display: grid; gap: .6rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); align-items: end; }
  .typed { border-top: 1px solid var(--line); padding-top: .8rem; }
  .fld.wide { grid-column: 1 / -1; }
  .unit { display: flex; align-items: baseline; gap: .4rem; }
  .unit i { font-style: normal; color: var(--muted); }
  .unit em { font-style: normal; color: var(--faint); font-size: .75rem; }
  .fld { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); }
  .fld input { font-size: .9rem; }
  .evt { display: flex; gap: .4rem; }
  .evt input { width: 4rem; flex: none; }
  .evt select { flex: 1; }
  .short { width: 6rem; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: .7rem; color: var(--muted); }
  code { font-size: .8rem; overflow-wrap: anywhere; }
  .hint { min-height: 8rem; place-content: center; }
  @media (max-width: 56rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
</style>

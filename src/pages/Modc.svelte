<script lang="ts">
  import { app, writeRaw } from "../lib/app.svelte";
  import { availableTypes, emptyModc, eventOptions, modcName, modcText, modcType, wordGet, wordSet, type Field, type Modc } from "../lib/device";
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
  const t = $derived(m ? modcType(m.type) : undefined);

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
    if (!confirm(`Block ${n} (${modcName(d.modc[n].type)}) entfernen?`)) return;
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
    <h2>Steuerblöcke</h2>
    <p class="muted">Blöcke verknüpfen Ereignisse (Taster, Fernbedienung, Quellen, andere Blöcke) mit Funktionen wie Lautstärke,
      Loudness oder Umschaltungen. {used.length} von {total} belegt.</p>
  </div>
  <button onclick={add} disabled={used.length >= total}>+ Block</button>
</header>

{#if err}<div class="panel alert" role="alert">Vom Gerät abgelehnt: {err}</div>{/if}

<div class="layout">
  <section class="panel list" aria-label="Blöcke">
    {#each used as n}
      {@const b = d.modc[n]}
      <button class="item" class:on={sel === n} aria-pressed={sel === n} onclick={() => (sel = n)}>
        <span class="nr num">{n}</span>
        <span class="nm">{modcName(b.type)}</span>
        <span class="dot" class:ok={!!b.enable} title={b.enable ? "aktiv" : "aus"}></span>
      </button>
    {/each}
    {#if !used.length}<p class="muted pad">Noch keine Blöcke.</p>{/if}
  </section>

  {#if m && sel !== null}
    <section class="panel edit">
      <div class="edithead">
        <span class="big num">{sel}</span>
        <select value={m.type} aria-label="Typ" onchange={(e) => setType(Number(e.currentTarget.value))}>
          {#if !types.some((x) => x.type === m.type)}<option value={m.type}>{modcName(m.type)}</option>{/if}
          {#each types as x}<option value={x.type}>{x.name}</option>{/each}
        </select>
        <button class="sw" class:on={!!m.enable} aria-pressed={!!m.enable} onclick={() => change((b) => (b.enable = b.enable ? 0 : 1))}>
          {m.enable ? "Aktiv" : "Aus"}</button>
        <button class="ghost del" title="Block entfernen" aria-label="Block entfernen" onclick={() => remove(sel!)}><Icon name="close" size={16} /></button>
      </div>
      {#if t}<p class="muted">{t.help}</p>{:else}<p class="muted">Für diesen Typ sind die Felder nicht beschrieben; unten stehen die Rohwerte.</p>{/if}
      <p class="muted small">Sein Ergebnis gibt der Block als Ereignis <span class="num">{96 + sel}</span> aus.</p>

      {#if t?.fields && !raw}
        <div class="fields typed">
          {#each t.fields as f}
            {#if f.kind === "event"}
              {@const ev = m.events[f.i - 1]}
              <label class="fld"><span>{f.label}</span>
                <span class="evt">
                  <input class="num" value={ev} inputmode="numeric" onchange={(e) => change((b) => (b.events[f.i - 1] = byte(e)))} />
                  <select value={events.some((o) => o.value === ev) ? ev : -1} aria-label="{f.label}: Ereignis wählen"
                    onchange={(e) => change((b) => (b.events[f.i - 1] = Number(e.currentTarget.value)))}>
                    {#if !events.some((o) => o.value === ev)}<option value={-1}>eigener Wert</option>{/if}
                    {#each events as o}<option value={o.value}>{o.label}</option>{/each}
                  </select>
                </span></label>
            {:else if f.kind === "byte"}
              <label class="fld"><span>{f.label}</span>
                <span class="unit"><input class="num short" value={dec(m[f.of][f.i - 1] * (f.mul ?? 1))} inputmode="decimal" onchange={(e) => setByte(f, e)} />
                  {#if f.unit}<i>{f.unit}</i>{/if}{#if f.hint}<em>{f.hint}</em>{/if}</span></label>
            {:else if f.kind === "word"}
              <label class="fld"><span>{f.label}</span>
                <span class="unit"><input class="num short" value={dec(wordGet(m.sets, f.i, f.signed) / (f.div ?? 1))} inputmode="decimal" onchange={(e) => setWord(f, e)} />
                  {#if f.unit}<i>{f.unit}</i>{/if}{#if f.hint}<em>{f.hint}</em>{/if}</span></label>
            {:else if f.kind === "choice"}
              {@const cur = m[f.of][f.i - 1] - (f.first ?? 0)}
              <label class="fld"><span>{f.label}</span>
                <select value={cur} onchange={(e) => change((b) => (b[f.of][f.i - 1] = Number(e.currentTarget.value) + (f.first ?? 0)))}>
                  {#if cur < 0 || cur >= f.options.length}<option value={cur}>Wert {m[f.of][f.i - 1]}</option>{/if}
                  {#each f.options as o, k}<option value={k}>{o}</option>{/each}
                </select></label>
            {:else if f.kind === "bits"}
              <div class="fld wide"><span>{f.label}</span>
                <div class="bits">
                  {#each f.bits as l, bit}
                    {#if l}
                      <label class="check"><input type="checkbox" checked={!!(m[f.of][f.i - 1] & (1 << bit))}
                        onchange={() => change((b) => (b[f.of][f.i - 1] ^= 1 << bit))} /> {l}</label>
                    {/if}
                  {/each}
                </div></div>
            {/if}
          {/each}
        </div>
      {:else}
        {#each [["events", "Ereignis"], ["sets", "Set"], ["flags", "Flags"]] as const as [of, name]}
          <div class="group">
            <h3>{of === "events" ? "Ereignisse" : of === "sets" ? "Werte (Sets)" : "Flags"}</h3>
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
        <label class="check"><input type="checkbox" bind:checked={raw} disabled={!t?.fields} /> Rohwerte zeigen (Ereignisse, Sets, Flags)</label>
        <code class="num">modc.{sel}={modcText(m)}</code>
      </div>
    </section>
  {:else}
    <section class="panel edit hint"><p class="muted">Links einen Block wählen oder mit „+ Block“ einen neuen anlegen.</p></section>
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

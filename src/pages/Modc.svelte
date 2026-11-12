<script lang="ts">
  import { app, writeRaw } from "../lib/app.svelte";
  import { availableTypes, emptyModc, eventOptions, modcName, modcText, modcType, type Modc } from "../lib/device";
  import Icon from "../components/Icon.svelte";

  const d = $derived(app.device);
  const total = $derived(d.identity.modcBlocks || 32);
  const used = $derived(Object.keys(d.modc).map(Number).filter((n) => d.modc[n].type !== 0).sort((a, b) => a - b));
  const types = $derived(availableTypes(d));
  const events = $derived(eventOptions(total));
  let sel = $state<number | null>(null);
  $effect(() => {
    if (sel === null && used.length) sel = used[0];
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
  const label = (list: string[] | undefined, i: number, fallback: string) => (list ? list[i] : fallback);
  const shown = (list: string[] | undefined, i: number) => raw || !list || list[i] !== "";
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

      {#each t?.bits ?? [] as bf}
        <div class="group">
          <h3>Wirkt auf</h3>
          <div class="bits">
            {#each bf.labels as l, bit}
              {#if l}
                <label class="check"><input type="checkbox" checked={!!(m.flags[bf.flag - 1] & (1 << bit))}
                  onchange={() => change((b) => (b.flags[bf.flag - 1] ^= 1 << bit))} /> {l}</label>
              {/if}
            {/each}
          </div>
        </div>
      {/each}

      <div class="group">
        <h3>Ereignisse</h3>
        <div class="fields">
          {#each m.events as ev, i}
            {#if shown(t?.events, i)}
              <label class="fld"><span>{label(t?.events, i, `Ereignis ${i + 1}`) || `Ereignis ${i + 1}`}</span>
                <span class="evt">
                  <input class="num" value={ev} inputmode="numeric" onchange={(e) => change((b) => (b.events[i] = byte(e)))} />
                  <select value={events.some((o) => o.value === ev) ? ev : -1} aria-label="Ereignis wählen"
                    onchange={(e) => change((b) => (b.events[i] = Number(e.currentTarget.value)))}>
                    {#if !events.some((o) => o.value === ev)}<option value={-1}>eigener Wert</option>{/if}
                    {#each events as o}<option value={o.value}>{o.label}</option>{/each}
                  </select>
                </span></label>
            {/if}
          {/each}
        </div>
      </div>

      {#if raw || !t?.sets || t.sets.some((x) => x)}
        <div class="group">
          <h3>Werte</h3>
          <div class="fields">
            {#each m.sets as v, i}
              {#if shown(t?.sets, i)}
                <label class="fld"><span>{label(t?.sets, i, `Set ${i + 1}`) || `Set ${i + 1}`}</span>
                  <input class="num short" value={v} inputmode="numeric" onchange={(e) => change((b) => (b.sets[i] = byte(e)))} /></label>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if raw || !t?.flags && !t?.bits || t?.flags?.some((x) => x)}
        <div class="group">
          <h3>Parameter</h3>
          <div class="fields">
            {#each m.flags as v, i}
              {#if raw || (t?.flags ? t.flags[i] !== "" : !t?.bits?.some((b) => b.flag === i + 1))}
                <label class="fld"><span>{t?.flags?.[i] || `Flags ${i + 1}`}</span>
                  <input class="num short" value={v} inputmode="numeric" onchange={(e) => change((b) => (b.flags[i] = byte(e)))} /></label>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <div class="foot">
        <label class="check"><input type="checkbox" bind:checked={raw} /> alle Felder zeigen</label>
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
  .fields { display: grid; gap: .5rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
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

<script lang="ts">
  // The typed fields of a control block (MODC), as in the dialogs of the original GUI. Used by the
  // page of the control blocks and by the device settings (#26).
  import { t, tx } from "../lib/i18n/index.svelte";
  import { choiceGet, choiceSet, wordGet, wordSet, type Field, type Modc } from "../lib/device";

  let { m, fields, events, change }: {
    m: Modc; fields: Field[]; events: { value: number; label: string }[];
    /** change the block (in place) and send it */
    change: (fn: (b: Modc) => void) => void;
  } = $props();

  const byte = (e: Event) => Math.max(0, Math.min(255, Math.round(Number((e.currentTarget as HTMLInputElement).value)) || 0));
  const dec = (n: number) => String(+n.toFixed(2)).replace(".", ",");
  const numOf = (e: Event) => Number((e.currentTarget as HTMLInputElement).value.replace(",", "."));
  function setByte(f: Extract<Field, { kind: "byte" }>, e: Event) {
    const v = numOf(e);
    if (!Number.isNaN(v)) change((b) => (b[f.of][f.i - 1] = Math.max(0, Math.min(255, Math.round(v / (f.mul ?? 1))))));
    (e.currentTarget as HTMLInputElement).value = dec(m[f.of][f.i - 1] * (f.mul ?? 1));
  }
  function setWord(f: Extract<Field, { kind: "word" }>, e: Event) {
    const div = f.div ?? 1, lo = f.min ?? (f.signed ? -32768 / div : 0), hi = f.max ?? (f.signed ? 32767 : 65535) / div;
    const v = numOf(e);
    if (!Number.isNaN(v)) change((b) => wordSet(b.sets, f.i, Math.max(lo, Math.min(hi, v)) * div));
    (e.currentTarget as HTMLInputElement).value = dec(wordGet(m.sets, f.i, f.signed) / div);
  }
</script>

        <div class="fields typed">
          {#each fields as f}
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

<style>
  select { padding: .4rem .5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); min-width: 0; }
  select option { background: var(--bg); }
  .bits { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; }
  .check { display: inline-flex; align-items: center; gap: .4rem; }
  .check input { accent-color: var(--accent); }
  .fields { display: grid; gap: .6rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); align-items: end; }
  .typed { border-top: 1px solid var(--line); padding-top: .8rem; }
  .fld.wide { grid-column: 1 / -1; }
  .unit { display: flex; align-items: baseline; gap: .4rem; flex-wrap: wrap; }
  .unit i { font-style: normal; color: var(--muted); }
  .unit em { font-style: normal; color: var(--faint); font-size: .75rem; }
  .fld { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); min-width: 0; }
  .fld input { font-size: .9rem; }
  .evt { display: flex; gap: .4rem; min-width: 0; }
  .evt input { width: 4rem; flex: none; }
  .evt select { flex: 1; }
  .short { width: 6rem; }
</style>

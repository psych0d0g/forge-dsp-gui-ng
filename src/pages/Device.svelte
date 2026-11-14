<script lang="ts">
  // Device settings (#26): what the control blocks hold about the device itself, in words instead of
  // type/flags/events/sets: switching on and off (the last block), Clickless, main clock, S/PDIF
  // receiver and ES9038PRO. Everything else stays on the page of the control blocks.
  import { t, tk, tx, type Key } from "../lib/i18n/index.svelte";
  import { app, sendModc, writeOnce } from "../lib/app.svelte";
  import { availableTypes, copyModc, decodeStartup, deviceHasChip, emptyModc, eventOptions, isPort, modcType, type Modc } from "../lib/device";
  import ModcFields from "../components/ModcFields.svelte";

  const d = $derived(app.device);
  const total = $derived(d.identity.modcBlocks || 32);
  const power = $derived(d.modc[total]);
  const events = $derived(eventOptions(total));
  const start = $derived(decodeStartup(d.startup));
  /** port firmware from 2.4.0: own hold time; before, set 3 also waited before remote out off */
  const hold = $derived(d.shutdownHold);
  let err = $state("");
  let saved = $state("");

  const dec = (n: number) => String(+n.toFixed(2)).replace(".", ",");
  const numOf = (e: Event) => Number((e.currentTarget as HTMLInputElement).value.replace(",", "."));
  const note = (e: string) => { err = e; saved = e ? "" : t("device.saved"); };

  /** set k of the last block, shown in seconds (step = seconds per count) */
  async function setPower(k: number, step: number, e: Event) {
    const v = numOf(e), b = power;
    if (!b || Number.isNaN(v)) return;
    const before = copyModc(b);
    b.sets[k - 1] = Math.max(0, Math.min(255, Math.round(v / step)));
    (e.currentTarget as HTMLInputElement).value = dec(b.sets[k - 1] * step);
    note(await sendModc(total, before));
  }
  async function setHold(e: Event) {
    const v = numOf(e);
    if (Number.isNaN(v)) return;
    const ms = Math.max(0, Math.min(25400, Math.round(v * 10) * 100));
    const r = await writeOnce("system.shutdown.hold", ms);
    if (!r) d.shutdownHold = ms;
    (e.currentTarget as HTMLInputElement).value = dec((d.shutdownHold ?? 0) / 1000);
    note(r);
  }
  async function setClickless(on: boolean) {
    const r = await writeOnce("biquad.clickless", on ? 1 : 0);
    if (!r) d.clickless = on ? 1 : 0;
    note(r);
  }

  // blocks about the hardware: one per type, set up on request in a free place
  const HW: { type: number; title: Key }[] = [
    { type: 68, title: tk("device.mainClock") }, { type: 69, title: tk("device.spdif") }, { type: 79, title: tk("device.es9038pro") },
  ];
  const avail = $derived(new Set(availableTypes(d).map((x) => x.type)));
  const blockOf = (type: number) => Object.keys(d.modc).map(Number).find((n) => n !== total && d.modc[n].type === type) ?? null;
  async function change(n: number, fn: (b: Modc) => void) {
    const before = copyModc(d.modc[n]);
    fn(d.modc[n]);
    note(await sendModc(n, before));
  }
  async function setUp(type: number) {
    const free = Array.from({ length: total - 1 }, (_, i) => i + 1).find((n) => !d.modc[n] || d.modc[n].type === 0);
    if (!free) { err = t("device.noFreeBlock"); return; }
    const before = copyModc(d.modc[free] ?? emptyModc());
    d.modc[free] = { ...emptyModc(), type, enable: 1 };
    note(await sendModc(free, before));
  }
  const sec = (ms: number) => dec(ms / 1000);
</script>

<header class="head">
  <h2>{t("device.title")}</h2>
  <p class="muted">{t("device.intro")}</p>
</header>

{#if err}<div class="panel alert" role="alert">{t("modc.refusedByDeviceErr", { err })}</div>{/if}
{#if saved && !err}<p class="ok small" role="status">{saved}</p>{/if}

{#if power}
  <section class="panel box" data-testid="power">
    <h3>{t("device.power")}</h3>
    <p class="muted">{t("device.powerIntro")}</p>

    <div class="flow" aria-label={t("device.accOn")}>
      <span class="ev">{t("device.accOn")}</span>
      <span class="arr">→</span>
      <span class="step">{t("device.firmwareStarts")}{#if start?.total}<small class="num">{sec(start.total - (start.stages.at(-1)?.ms ?? 0) - (start.stages.at(-2)?.ms ?? 0))} s {t("device.measured")}</small>{/if}</span>
      <span class="arr">→</span>
      <span class="step wait">{dec(power.sets[0] * 0.25)} s<small>{t("device.capWait")}</small></span>
      <span class="arr">→</span>
      <span class="ev">{t("device.remoteOn")}</span>
      <span class="arr">→</span>
      <span class="step wait">{dec(power.sets[2] * 0.25)} s<small>{t("device.capSettle")}</small></span>
      <span class="arr">→</span>
      <span class="ev ok">{t("device.sound")}</span>
    </div>
    <div class="fields">
      <label class="fld"><span>{t("device.beforeRemote")}</span>
        <span class="unit"><input class="num short" value={dec(power.sets[0] * 0.25)} inputmode="decimal" onchange={(e) => setPower(1, 0.25, e)} /><i>s</i>
          <em>{t("device.beforeRemoteHint")}</em></span></label>
      <label class="fld"><span>{t("device.ampsSettle")}</span>
        <span class="unit"><input class="num short" value={dec(power.sets[2] * 0.25)} inputmode="decimal" onchange={(e) => setPower(3, 0.25, e)} /><i>s</i>
          <em>{hold !== null ? t("device.ampsSettleHint") : t("device.ampsSettleHintOld")}</em></span></label>
    </div>

    <div class="flow" aria-label={t("device.accOff")}>
      <span class="ev">{t("device.accOff")}</span>
      {#if hold !== null}<span class="arr">→</span><span class="ev">{t("device.mutedAtOnce")}</span>{/if}
      <span class="arr">→</span>
      <span class="step wait">{dec(power.sets[1] * 0.05)} s<small>{t("device.capDebounce")}</small></span>
      {#if hold === null}<span class="arr">→</span><span class="ev">{t("device.muted")}</span>{/if}
      <span class="arr">→</span>
      <span class="step wait">{hold !== null ? sec(hold) : dec(power.sets[2] * 0.25)} s<small>{t("device.capHold")}</small></span>
      <span class="arr">→</span>
      <span class="ev">{t("device.remoteOff")}</span>
      <span class="arr">→</span>
      <span class="step wait">{dec(power.sets[3] * 0.25)} s<small>{t("device.capWait")}</small></span>
      <span class="arr">→</span>
      <span class="ev">{t("device.forgeOff")}</span>
    </div>
    <div class="fields">
      <label class="fld"><span>{t("device.debounce")}</span>
        <span class="unit"><input class="num short" value={dec(power.sets[1] * 0.05)} inputmode="decimal" onchange={(e) => setPower(2, 0.05, e)} /><i>s</i>
          <em>{t("device.debounceHint")}</em></span></label>
      {#if hold !== null}
        <label class="fld"><span>{t("device.hold")}</span>
          <span class="unit"><input class="num short" value={sec(hold)} inputmode="decimal" onchange={setHold} /><i>s</i>
            <em>{t("device.holdHint")}</em></span></label>
      {:else if isPort(d)}
        <p class="muted small">{t("device.holdNeeds")}</p>
      {/if}
      <label class="fld"><span>{t("device.beforeOff")}</span>
        <span class="unit"><input class="num short" value={dec(power.sets[3] * 0.25)} inputmode="decimal" onchange={(e) => setPower(4, 0.25, e)} /><i>s</i>
          <em>{t("device.beforeOffHint")}</em></span></label>
    </div>
  </section>
{/if}

{#if d.clickless !== null}
  <section class="panel box">
    <h3>Clickless</h3>
    <label class="row">
      <span><strong>{t("device.clickless")}</strong><small class="muted">{t("device.clicklessHint")}</small></span>
      <input type="checkbox" class="toggle" checked={!!d.clickless} onchange={(e) => setClickless(e.currentTarget.checked)} />
    </label>
  </section>
{/if}

{#each HW.filter((h) => avail.has(h.type) && deviceHasChip(d, h.type)) as h (h.type)}
  {@const n = blockOf(h.type)}
  {@const mt = modcType(h.type)}
  <section class="panel box">
    <div class="bhead">
      <h3>{t(h.title)}</h3>
      {#if n !== null}
        {@const b = d.modc[n]}
        <button class="sw" class:on={!!b.enable} aria-pressed={!!b.enable} onclick={() => change(n, (x) => (x.enable = x.enable ? 0 : 1))}>
          {b.enable ? t("modc.active2") : t("common.off2")}</button>
      {/if}
    </div>
    {#if mt}<p class="muted">{tx(mt.help)}</p>{/if}
    {#if n !== null && mt?.fields}
      <ModcFields m={d.modc[n]} fields={mt.fields} {events} change={(fn) => change(n, fn)} />
      <p class="muted small">{t("device.inBlock", { n })}</p>
    {:else}
      <button onclick={() => setUp(h.type)}>{t("device.setUp")}</button>
    {/if}
  </section>
{/each}

<style>
  .head { margin-bottom: 1rem; }
  .alert { padding: .5rem 1rem; margin-bottom: .75rem; border-color: var(--err); color: var(--err); }
  .ok { color: var(--ok); }
  .box { padding: .9rem 1rem; display: grid; gap: .7rem; margin-bottom: .75rem; }
  .bhead { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .small { font-size: .82rem; margin: 0; }
  .flow { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; font-size: .85rem; }
  .arr { color: var(--faint); }
  .ev { padding: .2rem .55rem; border-radius: 999px; background: var(--raised); border: 1px solid var(--line-strong); }
  .ev.ok { border-color: var(--ok); color: var(--ok); }
  .step { display: inline-flex; flex-direction: column; color: var(--muted); }
  .step small { font-size: .72rem; color: var(--faint); }
  .wait { font-variant-numeric: tabular-nums; }
  .fields { display: grid; gap: .6rem 1.25rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); align-items: start; margin-bottom: .4rem; }
  .fld { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); min-width: 0; }
  .fld input { font-size: .9rem; }
  .unit { display: flex; align-items: baseline; gap: .4rem; flex-wrap: wrap; }
  .unit i { font-style: normal; color: var(--muted); }
  .unit em { font-style: normal; color: var(--faint); font-size: .75rem; flex-basis: 100%; }
  .short { width: 6rem; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .row span { display: grid; gap: .15rem; }
  .toggle { width: 1.2rem; height: 1.2rem; accent-color: var(--accent); flex: none; }
  .sw { min-width: 4rem; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--ok) 20%, transparent); border-color: var(--ok); color: var(--ok); }
</style>

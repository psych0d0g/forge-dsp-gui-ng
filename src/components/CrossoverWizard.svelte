<script lang="ts">
  // Crossover wizard (#25): roles of the output pairs, crossover frequencies and slope; preview of
  // the left side with its electrical sum, then the high/low passes, polarity and names are written.
  import { t, tk, tx, type Key } from "../lib/i18n/index.svelte";
  import { app, setOutName, write } from "../lib/app.svelte";
  import { channelColor } from "../lib/channelColors";
  import { limitsOf, type Biquad } from "../lib/device";
  import { coeffs, type SumPart } from "../lib/dsp/biquad";
  import { bandsInUse, crossoverWrites, DEFAULT_FREQ, planCrossover, ROLE_NAME, ROLE_SHORT, ROLES, SLOPES,
    type Role, type Slope } from "../lib/dsp/crossover";
  import ResponsePlot from "./ResponsePlot.svelte";

  let { onclose, ondone }: { onclose: () => void; ondone: (note: string) => void } = $props();

  const d = $derived(app.device);
  const lim = $derived(limitsOf(d));
  const rate = $derived(d.identity.sampleRate || 96000);
  const pairs = $derived(Math.max(1, Math.floor((d.gain.out.length || 8) / 2)));
  const PRESETS: { name: Key; roles: Role[] }[] = [
    { name: tk("xover.p2"), roles: ["high", "low", "off", "off"] },
    { name: tk("xover.p2sub"), roles: ["high", "low", "off", "sub"] },
    { name: tk("xover.p3"), roles: ["high", "mid", "low", "off"] },
    { name: tk("xover.p3sub"), roles: ["high", "mid", "low", "sub"] },
  ];
  let roles = $state<Role[]>(["high", "low", "off", "sub"]);
  let freq = $state({ ...DEFAULT_FREQ });
  let slope = $state<Slope>("lr24");
  let subsonic = $state(0);
  let setNames = $state(true);
  let setPolarity = $state(true);

  const names = $derived(Object.fromEntries(ROLES.map((r) => [r, tx(ROLE_SHORT[r])])) as Record<Role, string>);
  const bands = $derived(bandsInUse(roles.slice(0, pairs)));
  const plan = $derived(planCrossover({ roles: roles.slice(0, pairs), freq, slope, subsonic }, names));
  const writes = $derived(plan.map((o) => ({ o, ...crossoverWrites(d.biquads[o.out] ?? {}, o.filters) })));
  const lost = $derived(writes.filter((w) => w.lost));
  // preview: the left output of every band, with its polarity
  const left = $derived(plan.filter((o) => o.out % 2 === 1));
  const overlays = $derived(left.map((o) => ({ name: tx(ROLE_NAME[o.role]), color: channelColor(o.out), filters: o.filters })));
  const sum = $derived<SumPart[]>(left.map((o) => ({ list: o.filters.map((b) => coeffs(b, rate)), gain: 1, invert: setPolarity && o.invert, delay: 0 })));

  function apply() {
    if (bands.length < 2) return;
    if (!confirm(t("xover.confirm", { n: plan.length }))) return;
    for (const w of writes) {
      for (const [n, bq] of w.writes) {
        d.biquads[w.o.out][n] = bq as Biquad;
        write(`biquad.${w.o.out}.${n}.calc`, [bq.type, bq.f, bq.gain, bq.q, bq.b, bq.flags]);
      }
      if (setPolarity && d.phase.length >= w.o.out && d.phase[w.o.out - 1] !== Number(w.o.invert)) {
        d.phase[w.o.out - 1] = Number(w.o.invert);
        write(`phase.out.${w.o.out}`, Number(w.o.invert));
      }
      if (setNames) setOutName(w.o.out, w.o.name);
    }
    ondone(t("xover.done", { n: plan.length }));
  }
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value.replace(",", "."));
  const clampF = (v: number) => Math.round(Math.min(lim.freq[1], Math.max(lim.freq[0], v)));
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="panel dlg" role="dialog" aria-modal="true" aria-labelledby="xover-title" data-testid="xover">
  <div class="top">
    <h3 id="xover-title">{t("xover.title")}</h3>
    <button class="ghost" onclick={onclose}>{t("compare.close")}</button>
  </div>
  <p class="muted small">{t("xover.intro")}</p>

  <div class="row">
    <span class="muted">{t("xover.preset")}</span>
    {#each PRESETS as p}<button onclick={() => (roles = [...p.roles])}>{t(p.name)}</button>{/each}
  </div>

  <div class="grid">
    {#each { length: pairs } as _, i}
      <label class="fld"><span>{t("xover.pair", { a: i * 2 + 1, b: i * 2 + 2 })}</span>
        <select value={roles[i] ?? "off"} onchange={(e) => (roles[i] = e.currentTarget.value as Role)}>
          {#each ROLES as r}<option value={r}>{t(ROLE_NAME[r])}</option>{/each}
        </select></label>
    {/each}
  </div>

  <div class="grid">
    {#each bands.slice(1) as b}
      {@const k = b as "low" | "mid" | "high"}
      <label class="fld"><span>{t("xover.freqBelow", { band: t(ROLE_NAME[b]) })}</span>
        <span class="unit"><input class="num short" value={freq[k]} inputmode="numeric"
          onchange={(e) => { const v = num(e); if (v > 0) freq[k] = clampF(v); (e.currentTarget as HTMLInputElement).value = String(freq[k]); }} /><i>Hz</i></span></label>
    {/each}
    <label class="fld"><span>{t("xover.slope")}</span>
      <select bind:value={slope}>{#each SLOPES as s}<option value={s.id}>{t(s.name)}</option>{/each}</select></label>
    <label class="fld"><span>{t("xover.subsonic")}</span>
      <span class="unit"><input class="num short" value={subsonic} inputmode="numeric"
        onchange={(e) => { const v = num(e); subsonic = v > 0 ? clampF(v) : 0; (e.currentTarget as HTMLInputElement).value = String(subsonic); }} /><i>Hz</i>
        <em>{t("xover.subsonicHint")}</em></span></label>
  </div>

  <div class="row">
    <label class="check"><input type="checkbox" bind:checked={setPolarity} /> {t("xover.setPolarity")}</label>
    <label class="check"><input type="checkbox" bind:checked={setNames} /> {t("xover.setNames")}</label>
  </div>

  {#if bands.length >= 2}
    <p class="muted small">{t("xover.preview")}</p>
    <ResponsePlot filters={[]} {rate} freq={lim.freq} {overlays} sum={sum.length > 1 ? sum : null} gainRange={lim.bqGain} selected={null}
      showPhase={false} showTotal={false} onselect={() => {}} onmove={() => {}} onq={() => {}} />
    <div class="legend">{#each overlays as o}<span><i style="background:{o.color}"></i>{o.name}</span>{/each}<span><i class="dash"></i>{t("xover.sum")}</span></div>
    {#each lost as w}<p class="warn small">{t("xover.lost", { out: w.o.out, n: w.lost })}</p>{/each}
  {:else}
    <p class="warn small">{t("xover.needTwo")}</p>
  {/if}

  <div class="row end">
    <button class="ghost" onclick={onclose}>{t("common.cancel")}</button>
    <button class="primary" disabled={bands.length < 2} onclick={apply}>{t("xover.apply")}</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); z-index: 60; }
  .dlg { position: fixed; z-index: 61; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(56rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem); overflow: auto; padding: 1rem 1.2rem; display: grid; gap: .6rem;
  }
  /* opaque: the page behind does not show through (.panel is translucent glass) */
  .panel.dlg { background: var(--bg); backdrop-filter: none; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  h3 { margin: 0; }
  .small { font-size: .82rem; margin: 0; }
  .warn { color: var(--warn); }
  .row { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; }
  .row.end { justify-content: flex-end; }
  .grid { display: grid; gap: .5rem 1rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); align-items: start; }
  .fld { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); min-width: 0; }
  select { padding: .4rem .5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--raised); min-width: 0; }
  select option { background: var(--bg); }
  .unit { display: flex; align-items: baseline; gap: .4rem; flex-wrap: wrap; }
  .unit i { font-style: normal; color: var(--muted); }
  .unit em { font-style: normal; color: var(--faint); font-size: .75rem; flex-basis: 100%; }
  .short { width: 6rem; }
  .legend { display: flex; flex-wrap: wrap; gap: .3rem 1rem; font-size: .8rem; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: .35rem; }
  .legend i { width: .9rem; height: .2rem; border-radius: 2px; display: inline-block; }
  .legend i.dash { background: repeating-linear-gradient(90deg, var(--fg) 0 3px, transparent 3px 6px); }
  .check { display: inline-flex; align-items: center; gap: .4rem; }
  .check input { accent-color: var(--accent); }
</style>

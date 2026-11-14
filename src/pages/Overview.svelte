<script lang="ts">
  import { app, inName, meter, outName, type PageId } from "../lib/app.svelte";
  import { decodeStartup, formatUptime, INPUT_PAIRS, isPort, rawToDb } from "../lib/device";
  import Icon from "../components/Icon.svelte";
  import LevelBar from "../components/LevelBar.svelte";
  import { t } from "../lib/i18n/index.svelte";

  const d = $derived(app.device);
  const id = $derived(d.identity);
  const serial = $derived(id.keyInfo.split("-")[3] ?? "");
  const allBq = $derived(Object.values(d.biquads).flatMap((c) => Object.values(c)));
  const activeBq = $derived(allBq.filter((b) => b.type !== 0 && (b.flags & 0x80) !== 0).length);
  const delayed = $derived(d.delay.out.filter((x) => x > 0).length);
  const go = (p: PageId) => (app.page = p);
  // start-up times and uptime (forge-dsp-firmware#67); the uptime runs on between two reads
  const start = $derived(decodeStartup(d.startup));
  let now = $state(Date.now());
  $effect(() => {
    const iv = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(iv);
  });
  const uptime = $derived(d.uptime ? d.uptime.ms + Math.max(0, now - d.uptime.at) : null);
  const sec = (ms: number) => (ms / 1000).toFixed(ms < 10000 ? 2 : 1);
  const db = (raw: number) => {
    const s = d.scales.out;
    if (!s) return "";
    if (raw <= s.min) return "−∞";
    const v = rawToDb(s, raw);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  };
  const stages = $derived([
    { page: "mixer" as PageId, icon: "inputs", title: t("overview.inputs"), inputs: true,
      lines: [t("overview.nAnalogPairs", { n: id.analogInPairs }), t("overview.nDigital", { n: id.spdifPairs })] },
    { page: "mixer" as PageId, icon: "mixer", title: t("common.mixer"), inputs: false,
      lines: [t("common.profileN", { n: d.mixer.position || "–" }), d.mixer.input !== null ? t("common.sourceN", { n: d.mixer.input }) : ""] },
    { page: "filters" as PageId, icon: "filters", title: t("common.filtersEQ"), inputs: false,
      lines: [t("overview.nActive", { n: activeBq }), t("overview.n", { n: allBq.length })] },
    { page: "delay" as PageId, icon: "delay", title: t("common.delay"), inputs: false,
      lines: [delayed ? t("overview.nChannelsDelayed", { n: delayed }) : t("overview.noDelay")] },
  ]);
</script>

<header class="head">
  <div>
    <h2>{id.model ? `Forge DSP ${id.model}` : t("common.overview")}</h2>
    <p class="muted">{t("overview.signalPathFromLeft")}</p>
  </div>
  {#if d.vu}
    <button class="ghost floor" onclick={() => go("settings")} title={t("overview.whereLevelBarsStart")}>
      {t("overview.levelMeterFromN", { n: meter.floor })}</button>
  {/if}
</header>

<div class="flow">
  {#each stages as s}
    <button class="panel stage" onclick={() => go(s.page)}>
      <span class="ico"><Icon name={s.icon} size={20} /></span>
      <strong>{s.title}</strong>
      {#each s.lines as l}{#if l}<span class="muted">{l}</span>{/if}{/each}
      {#if s.inputs && d.vu}
        <div class="levels">
          {#each INPUT_PAIRS as p}
            {#each p.in as n}
              <span class="lv-n">{inName(n)}</span><LevelBar value={d.vu[n - 1]} label={inName(n)} number />
            {/each}
          {/each}
        </div>
      {/if}
    </button>
    <span class="arrow" aria-hidden="true"></span>
  {/each}
  <button class="panel stage outs" onclick={() => go("mixer")}>
    <span class="ico"><Icon name="outputs" size={20} /></span>
    <strong>{t("common.outputs")}</strong>
    <div class="chans">
      {#each d.gain.out as raw, i}
        <div class="chan" class:muted={!!d.mute[i]}>
          <span class="n num">{i + 1}</span>
          <span class="nm">{outName(i + 1)}</span>
          <span class="v num">{d.mute[i] ? t("overview.muted") : `${db(raw)} dB`}</span>
          {#if d.vuOut}<span class="lvl"><LevelBar value={d.vuOut[i]} label={d.mute[i] ? t("overview.nameMutedLevelBefore", { name: outName(i + 1) }) : outName(i + 1)} /></span>{/if}
        </div>
      {/each}
    </div>
  </button>
</div>

<div class="tiles">
  <section class="panel tile">
    <h3>{t("common.device")}</h3>
    <dl>
      <dt>{t("common.model")}</dt><dd>{id.model || "–"} <span class="muted">PCB {id.pcb || "–"}</span></dd>
      <dt>Firmware</dt><dd class="num">{id.port ? `Port ${id.port}` : id.firmware || "–"}
        {#if id.port}<span class="muted">({t("common.protocolV", { v: id.firmware })})</span>{/if}</dd>
      <dt>{t("common.sampleRate")}</dt><dd class="num">{id.sampleRate ? `${id.sampleRate / 1000} kHz` : "–"}</dd>
      <dt>{t("overview.serialNumber")}</dt><dd class="num">{serial || "–"}</dd>
    </dl>
  </section>
  <section class="panel tile">
    <h3>{t("common.state")}</h3>
    <dl>
      <dt>Preset</dt><dd class="num">{d.preset.loaded !== null ? d.preset.loaded + 1 : "–"} <span class="muted">{t("overview.n", { n: id.presets || "–" })}</span></dd>
      <dt>{t("common.temperature")}</dt><dd class="num">{d.temperature !== null ? `${d.temperature.toFixed(1)} °C` : "–"}</dd>
      <dt>Clickless</dt><dd>{d.clickless === null ? t("overview.notAvailable") : d.clickless ? t("overview.on") : t("common.off")}</dd>
      <dt>{t("common.errorCounters")}</dt><dd class="num">{d.errors.length ? t("overview.nEntries", { n: d.errors.length }) : t("common.none")}</dd>
    </dl>
  </section>
  {#if isPort(d)}
    <section class="panel tile" data-testid="startup">
      <h3>{t("startup.title")}</h3>
      {#if start}
        <dl>
          {#if uptime !== null}<dt>{t("startup.uptime")}</dt><dd class="num">{formatUptime(uptime)}</dd>{/if}
          <dt>{t("startup.toSound")}</dt><dd class="num">{start.total !== null ? `${sec(start.total)} s` : t("startup.notReached")}</dd>
        </dl>
        {#if start.total}
          <div class="bar" aria-hidden="true">
            {#each start.stages as s, i}{#if s.ms}<span class="seg" class:warn={i === 0 && start.stuck} style="flex-grow:{s.ms}; --o:{0.35 + 0.65 * ((i % 4) / 3)}" title="{t(s.key)}: {sec(s.ms)} s"></span>{/if}{/each}
          </div>
        {/if}
        {#if start.stuck}<p class="warn small">{t("startup.stuck", { s: sec(start.bootloader) })}</p>{/if}
        <dl class="stages">
          {#each start.stages as s}
            <dt title={s.hint ? t(s.hint) : ""}>{t(s.key)}</dt><dd class="num">{s.ms === null ? t("startup.notReached") : `${sec(s.ms)} s`}</dd>
          {/each}
        </dl>
      {:else}
        <dl>{#if uptime !== null}<dt>{t("startup.uptime")}</dt><dd class="num">{formatUptime(uptime)}</dd>{/if}</dl>
        <p class="muted small">{t("startup.needs")}</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .head { margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .floor { display: inline-flex; align-items: center; gap: .5rem; font-size: .82rem; }
  .levels :global(.wrap) { min-width: 0; }
  /* the inputs are wider: their level bars are used to set the analog gain pots */
  .flow { display: grid; grid-template-columns: minmax(13rem, 1.6fr) 1.5rem repeat(3, minmax(7.5rem, .8fr) 1.5rem) minmax(17rem, 2.4fr); align-items: stretch; }
  .stage { display: flex; flex-direction: column; align-items: flex-start; gap: .15rem; padding: .9rem 1rem; text-align: left; font: inherit; }
  .stage:hover:not(:disabled) { border-color: var(--accent); background: var(--panel); }
  .ico { color: var(--accent); margin-bottom: .35rem; }
  .arrow { align-self: center; height: 2px; background: var(--line-strong); position: relative; }
  .arrow::after { content: ""; position: absolute; right: 0; top: -4px; border: 5px solid transparent; border-left-color: var(--line-strong); border-right: 0; }
  .chans { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem 1rem; width: 100%; margin-top: .3rem; }
  .chan { display: flex; gap: .45rem; align-items: baseline; font-size: .82rem; min-width: 0; }
  .chan .n { color: var(--faint); }
  .chan .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chan .v { color: var(--muted); }
  .chan { flex-wrap: wrap; }
  .chan .lvl { flex-basis: 100%; padding: .05rem 0 .25rem 1rem; }
  /* mute acts in the DAC, after the measuring point: the level is there but not audible */
  .chan.muted .lvl { opacity: .3; }
  .levels { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: .2rem .5rem; width: 100%; margin-top: .45rem; }
  .lv-n { font-size: .7rem; color: var(--muted); white-space: nowrap; }
  .chan.muted .v { color: var(--err); }
  .tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); margin-top: .75rem; }
  .tile { padding: .9rem 1rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.25rem; margin: .6rem 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .bar { display: flex; height: .55rem; border-radius: 4px; overflow: hidden; margin: .7rem 0 .2rem; gap: 1px; background: var(--line); }
  .seg { min-width: 2px; background: color-mix(in srgb, var(--accent) calc(var(--o) * 100%), var(--raised)); }
  .seg.warn { background: var(--warn); }
  .stages { font-size: .85rem; }
  .stages dt { cursor: help; }
  .warn { color: var(--warn); }
  .small { font-size: .82rem; margin: .4rem 0 0; }
  @media (max-width: 62rem) {
    .flow { grid-template-columns: 1fr; }
    .arrow { width: 2px; height: 1rem; justify-self: center; }
    .arrow::after { right: -4px; top: auto; bottom: 0; border: 5px solid transparent; border-top-color: var(--line-strong); border-bottom: 0; }
  }
</style>

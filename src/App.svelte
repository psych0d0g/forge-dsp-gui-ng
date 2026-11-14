<script lang="ts">
  import { onMount } from "svelte";
  import { app, connect, disconnect, selectDevice, findSim, portChoice, sim, refreshPorts, reload, usbAvailable, type PageId } from "./lib/app.svelte";
  import PortPicker from "./components/PortPicker.svelte";
  import { servedByBridge } from "./lib/transport/websocket";
  import Icon from "./components/Icon.svelte";
  import VuMeter from "./components/VuMeter.svelte";
  import MasterFader from "./components/MasterFader.svelte";
  import Overview from "./pages/Overview.svelte";
  import Console from "./pages/Console.svelte";
  import Delay from "./pages/Delay.svelte";
  import Mixer from "./pages/Mixer.svelte";
  import Filters from "./pages/Filters.svelte";
  import Diagnose from "./pages/Diagnose.svelte";
  import Presets from "./pages/Presets.svelte";
  import ModcPage from "./pages/Modc.svelte";
  import Firmware from "./pages/Firmware.svelte";
  import Biquads from "./pages/Biquads.svelte";
  import SdCard from "./pages/SdCard.svelte";
  import Settings from "./pages/Settings.svelte";
  import { i18n, setLang, t, tk, tx } from "./lib/i18n/index.svelte";

  const version = __APP_VERSION__;
  const commit = __APP_COMMIT__;
  let onBridge = $state(false);
  let navOpen = $state(false);
  let theme = $state<"dark" | "light" | "">("");

  // navigation in the order of the signal path, then control, then tools
  const NAV: { group: string; items: { id: PageId; label: string }[] }[] = [
    { group: tk("common.device"), items: [{ id: "overview", label: tk("common.overview") }] },
    { group: tk("app.signalPath"), items: [
      { id: "mixer", label: tk("common.mixer") }, { id: "filters", label: tk("common.filtersEQ") }, { id: "delay", label: tk("common.delay") }] },
    { group: tk("app.control"), items: [{ id: "modc", label: tk("common.controlBlocks") }, { id: "presets", label: tk("common.presets") },
      { id: "biquads", label: tk("common.biquadAllocation") }] },
    { group: tk("app.tools"), items: [
      { id: "diagnose", label: tk("common.diagnostics") }, { id: "sdcard", label: tk("common.memoryCard") }, { id: "firmware", label: tk("common.firmware") }, { id: "settings", label: tk("common.settings") },
      { id: "console", label: tk("common.console") }] },
  ];

  onMount(async () => {
    theme = (localStorage.getItem("theme") as "dark" | "light" | null) ?? "";
    // ?demo (and &page=outputs): the interface without a device, for a first look and screenshots
    const q = new URLSearchParams(location.search);
    if (q.get("theme") === "dark" || q.get("theme") === "light") theme = q.get("theme") as "dark" | "light";
    if (q.has("demo")) {
      await connect("demo");
      if (q.get("page")) app.page = (["inputs", "outputs"].includes(q.get("page")!) ? "mixer" : q.get("page")) as PageId;
      return;
    }
    void findSim();
    if (q.has("sim")) {   // ?sim[=flavour]: straight into the simulator
      await findSim();
      if (q.get("sim")) sim.flavour = q.get("sim")!;
      if (sim.flavour) { await connect("sim"); return; }
    }
    onBridge = await servedByBridge();
    if (onBridge) connect("esp");
  });
  $effect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  });
  function toggleTheme() {
    const dark = theme ? theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
    theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
  }
  function open(id: PageId) {
    app.page = id;
    navOpen = false;
  }
  const online = $derived(app.status === "online");
  const title = $derived(app.bootloader ? (app.device.identity.model ? t("app.forgeBootloaderModel", { model: app.device.identity.model }) : t("app.forgeBootloader"))
    : app.bootWait ? t("app.waitingBootloader") : app.device.identity.model ? `Forge DSP ${app.device.identity.model}` : t("app.noDevice"));
</script>

<div class="shell" class:nav-open={navOpen}>
  <aside class="glass side">
    <div class="brand"><span class="logo">F</span><span>Forge DSP</span></div>
    <nav>
      {#each NAV as g}
        <h3>{tx(g.group)}</h3>
        {#each g.items as it}
          <button class="navitem" class:active={app.page === it.id} aria-current={app.page === it.id ? "page" : undefined}
            disabled={(!!app.bootloader || app.bootWait) && it.id !== "firmware"}
            title={app.bootloader && it.id !== "firmware" ? t("app.bootloaderOnlyFirmwareUpdate") : undefined}
            onclick={() => open(it.id)}>
            <Icon name={it.id} /><span>{tx(it.label)}</span>
          </button>
        {/each}
      {/each}
    </nav>
  </aside>
  <button class="scrim" aria-label={t("app.closeMenu")} onclick={() => (navOpen = false)}></button>

  <header class="glass top">
    <button class="ghost menu" aria-label={t("app.menu")} onclick={() => (navOpen = !navOpen)}><Icon name="menu" size={20} /></button>
    <div class="device">
      <span class="dot" class:ok={online} class:busy={app.status === "connecting" || app.status === "reading"}></span>
      <div><strong>{title}</strong>
        <span class="muted sub">{online ? `${app.transportName}${app.demo ? ` ${t("app.noDevice2")}` : ""}${app.bootloader ? `, Bootloader ${app.bootloader.version}` : ""}`
          : app.status === "offline" ? t("common.notConnected") : t("app.connecting")}</span></div>
    </div>
    {#if app.chain.length > 1}
      <select class="chainsel" aria-label={t("app.chainDevice")} value={app.target} disabled={app.status !== "online"}
        onchange={(e) => selectDevice(Number(e.currentTarget.value))}>
        {#each app.chain as c}<option value={c.n}>{t("app.chainEntry", { n: c.n, model: c.model || "?" })}</option>{/each}
      </select>
    {/if}
    {#if online && !app.bootloader}<div class="live"><VuMeter /><MasterFader /></div>{/if}
    <div class="actions">
      {#if online}
        {#if !app.demo && !app.bootloader}<button class="ghost" title={t("app.readEverythingAgain")} onclick={reload}><Icon name="refresh" /></button>{/if}
        <button onclick={disconnect}>{t("app.disconnect")}</button>
      {:else if app.status === "offline"}
        <!-- the welcome panel has the connect buttons; here only where it is not shown -->
        {#if app.page === "console"}
          {#if usbAvailable()}<button class="primary" onclick={() => connect("usb")}><Icon name="usb" size={16} /> {t("app.connectUSB")}</button>{/if}
          {#if onBridge}<button onclick={() => connect("esp")}>{t("app.connectESP32")}</button>{/if}
        {/if}
      {/if}
      <button class="ghost lang" title={t("common.language")} aria-label={t("common.language")} onclick={() => setLang(i18n.lang === "de" ? "en" : "de")}>{i18n.lang === "de" ? "EN" : "DE"}</button>
      <button class="ghost" title={t("app.lightDark")} aria-label={t("app.lightDark")} onclick={toggleTheme}><Icon name="sun" /></button>
    </div>
  </header>

  <main>
    {#if app.error}
      <div class="panel alert" role="alert"><span>{app.error}</span><button class="ghost" onclick={() => (app.error = "")}>{t("app.close")}</button></div>
    {/if}
    {#if app.status === "reading" && app.progress}
      <div class="center">
        <section class="panel welcome">
          <h2>{t("app.readingDevice")}</h2>
          <p class="muted">{t("app.mixerFiltersTakeFew")}</p>
          <progress value={app.progress.done} max={app.progress.total}></progress>
          <p class="muted num">{app.progress.current}</p>
        </section>
      </div>
    {:else if !online && app.page !== "console" && !app.bootWait}
      <div class="center">
        <section class="panel welcome">
          <span class="logo big">F</span>
          <h2>{t("app.setUpForgeDSP")}</h2>
          {#if usbAvailable()}
            <p class="muted">{t("app.connectForgeByUSB")}</p>
            <div class="btns">
              <button class="primary" disabled={app.status !== "offline"} onclick={() => connect("usb")}><Icon name="usb" size={16} /> {t("app.connectUSB")}</button>
              <button disabled={app.status !== "offline"} onclick={() => connect("demo")}>{t("app.tryWithoutDevice")}</button>
              {#if sim.flavours.length}
                <span class="simpick"><button disabled={app.status !== "offline"} title={t("app.realFirmwareBrowserNo")}
                  onclick={() => connect("sim")}>Simulator</button>
                  {#if sim.flavours.length > 1}<select bind:value={sim.flavour} aria-label={t("app.modelSimulator")}>
                    {#each sim.flavours as f}<option value={f}>{f}</option>{/each}</select>{/if}</span>
              {/if}
            </div>
          {:else}
            <p class="muted">{t("app.browserHasNoSerial")}</p>
            <div class="btns">
              {#if onBridge}<button class="primary" onclick={() => connect("esp")}>{t("app.connectESP32")}</button>{/if}
              <button onclick={() => connect("demo")}>{t("app.tryWithoutDevice")}</button>
              {#if sim.flavours.length}
                <span class="simpick"><button disabled={app.status !== "offline"} title={t("app.realFirmwareBrowserNo")}
                  onclick={() => connect("sim")}>Simulator</button>
                  {#if sim.flavours.length > 1}<select bind:value={sim.flavour} aria-label={t("app.modelSimulator")}>
                    {#each sim.flavours as f}<option value={f}>{f}</option>{/each}</select>{/if}</span>
              {/if}
            </div>
          {/if}
        </section>
      </div>
    {:else if app.page === "overview"}<Overview />
    {:else if app.page === "delay"}<Delay />
    {:else if app.page === "mixer"}<Mixer />
    {:else if app.page === "filters"}<Filters />
    {:else if app.page === "diagnose"}<Diagnose />
    {:else if app.page === "presets"}<Presets />
    {:else if app.page === "modc"}<ModcPage />
    {:else if app.page === "biquads"}<Biquads />
    {:else if app.page === "sdcard"}<SdCard />
    {:else if app.page === "settings"}<Settings />
    {:else if app.page === "firmware"}<Firmware />
    {:else if app.page === "console"}<Console />
    {/if}
  </main>

  <footer class="glass status num">
    <span>{online ? (app.writing ? t("app.writing") : t("app.ready")) : "offline"}</span>
    {#if online}
      <span>{app.device.identity.port ? `Port ${app.device.identity.port}` : `Firmware ${app.device.identity.firmware}`}</span>
      {#if app.device.preset.loaded !== null}<span>Preset {app.device.preset.loaded + 1}</span>{/if}
      {#if app.device.temperature !== null}<span>{app.device.temperature.toFixed(1)} °C</span>{/if}
    {/if}
    <span class="right">GUI {version} ({commit})</span>
  </footer>
</div>

{#if portChoice.ports && portChoice.resolve}
  <PortPicker ports={portChoice.ports} onpick={(p) => portChoice.resolve?.(p)} onrefresh={refreshPorts} />
{/if}

<style>
  .simpick { display: inline-flex; gap: .4rem; align-items: center; }
  .chainsel { font: inherit; font-size: .85rem; padding: .25rem .4rem; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--fg); }
  .lang { font-size: .75rem; font-weight: 650; letter-spacing: .04em; min-width: 2.2rem; }
  .shell { height: 100%; display: grid; grid-template: "side top" auto "side main" 1fr "side status" auto / 14.5rem minmax(0, 1fr); }
  .side { grid-area: side; border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; z-index: 3; }
  .brand { display: flex; align-items: center; gap: .6rem; padding: .95rem 1rem .6rem; font-weight: 650; letter-spacing: -.01em; }
  .logo { width: 1.6rem; height: 1.6rem; border-radius: 7px; display: grid; place-items: center; font-weight: 800;
    background: linear-gradient(140deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #3b2bd6)); color: var(--accent-ink); }
  .logo.big { width: 3rem; height: 3rem; font-size: 1.5rem; border-radius: 12px; }
  nav { overflow-y: auto; padding: 0 .5rem 1rem; display: flex; flex-direction: column; gap: 1px; }
  nav h3 { padding: .9rem .55rem .3rem; }
  .navitem { display: flex; align-items: center; gap: .65rem; width: 100%; text-align: left; border: 0; background: none; padding: .45rem .55rem;
    border-radius: 8px; color: var(--muted); }
  .navitem span:nth-child(2) { flex: 1; }
  .navitem:hover:not(:disabled) { color: var(--fg); }
  .navitem:disabled { opacity: .4; cursor: not-allowed; }
  .navitem.active { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--fg); }
  .navitem.active :global(svg) { color: var(--accent); }

  .top { grid-area: top; display: flex; align-items: center; gap: .75rem; padding: .55rem 1rem; border-bottom: 1px solid var(--line); z-index: 2; }
  .menu { display: none; padding: .3rem; }
  .device { display: flex; align-items: center; gap: .65rem; margin-right: auto; min-width: 0; }
  .device strong { display: block; line-height: 1.2; }
  .sub { font-size: .8rem; }
  .actions { display: flex; align-items: center; gap: .4rem; }
  .live { display: flex; align-items: center; gap: .75rem; min-width: 0; }
  .actions button { display: inline-flex; align-items: center; gap: .4rem; }

  main { grid-area: main; overflow: auto; padding: 1.25rem; display: flex; flex-direction: column; min-height: 0; }
  .center { flex: 1; display: grid; place-items: center; }
  .welcome { padding: 2rem; max-width: 30rem; display: grid; gap: .8rem; justify-items: start; }
  .btns { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .4rem; }
  .btns button { display: inline-flex; align-items: center; gap: .4rem; }
  progress { width: 100%; accent-color: var(--accent); }
  .alert { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .5rem .5rem .5rem 1rem; margin-bottom: 1rem;
    border-color: var(--err); color: var(--err); }

  .status { grid-area: status; display: flex; gap: 1.25rem; padding: .3rem 1rem; font-size: .75rem; color: var(--muted); border-top: 1px solid var(--line); }
  .right { margin-left: auto; }
  .scrim { display: none; }

  @media (max-width: 52rem) {
    .shell { grid-template: "top" auto "main" 1fr "status" auto / minmax(0, 1fr); }
    .side { position: fixed; inset: 0 auto 0 0; width: 15rem; transform: translateX(-100%); transition: transform .18s; }
    .nav-open .side { transform: none; }
    .nav-open .scrim { display: block; position: fixed; inset: 0; z-index: 2; background: rgba(0, 0, 0, .45); border: 0; border-radius: 0; padding: 0; }
    .menu { display: inline-flex; }
    main { padding: .9rem; }
    .status span:not(:first-child):not(.right) { display: none; }
  }
  /* phone: level and master in a row of their own below the device */
  @media (max-width: 40rem) {
    .top { flex-wrap: wrap; row-gap: .4rem; padding: .5rem .75rem; }
    .live { order: 3; flex-basis: 100%; justify-content: space-between; }
  }
</style>

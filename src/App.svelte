<script lang="ts">
  import { onMount } from "svelte";
  import { ForgeClient, type Answer } from "./lib/protocol";
  import type { Transport } from "./lib/transport/types";
  import { openWebSerial, webSerialAvailable } from "./lib/transport/webserial";
  import { openWebSocket, servedByBridge } from "./lib/transport/websocket";

  let transport: Transport | null = $state(null);
  let client: ForgeClient | null = $state(null);
  let onBridge = $state(false);
  let error = $state("");
  let device = $state<{ key?: string; firmware?: string; info?: string }>({});
  let log = $state<{ dir: "rx" | "tx"; text: string }[]>([]);
  let input = $state("get.1 system.ping");
  const version = __APP_VERSION__;
  const commit = __APP_COMMIT__;

  onMount(async () => {
    onBridge = await servedByBridge();
    if (onBridge) connect("esp");
  });

  async function connect(kind: "usb" | "esp") {
    error = "";
    try {
      transport = kind === "usb" ? await openWebSerial() : await openWebSocket();
      client = new ForgeClient(transport);
      client.onRaw((text, dir) => (log = [...log.slice(-300), { dir, text: text.trimEnd() }]));
      await identify();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      transport = null;
      client = null;
    }
  }

  async function disconnect() {
    await transport?.close();
    transport = null;
    client = null;
    device = {};
  }

  const first = (a: Answer[]) => (a[0]?.value !== undefined ? JSON.stringify(a[0].value) : a[0]?.message);

  async function identify() {
    if (!client) return;
    device = {
      key: first(await client.get("system.key.info")),
      firmware: first(await client.get("system.firmware")),
      info: first(await client.get("system.info")),
    };
  }

  async function sendRaw(e: SubmitEvent) {
    e.preventDefault();
    if (client && input.trim()) await client.send(input.trim()).catch((x) => (error = String(x)));
  }
</script>

<header>
  <h1>Forge DSP</h1>
  {#if transport}
    <span class="badge ok">verbunden: {transport.name}</span>
    <button onclick={disconnect}>Trennen</button>
  {:else}
    {#if webSerialAvailable()}
      <button class="primary" onclick={() => connect("usb")}>USB verbinden</button>
    {/if}
    {#if onBridge}<button onclick={() => connect("esp")}>ESP32 verbinden</button>{/if}
  {/if}
</header>

<main>
  {#if error}<p class="err">{error}</p>{/if}
  {#if !transport && !webSerialAvailable() && !onBridge}
    <section class="hint">
      <h2>Dieser Browser kann nicht per USB verbinden</h2>
      <p>Die Verbindung zum Forge läuft über Web Serial. Das gibt es in <strong>Chrome</strong> und <strong>Edge</strong>
        (Desktop), nicht in Firefox und Safari. Alternativ: ESP32-Brücke am RS485-Port, dann läuft die Oberfläche
        in jedem Browser über WLAN.</p>
    </section>
  {/if}

  <section>
    <h2>Gerät</h2>
    {#if device.key}
      <dl>
        <dt>Kennung</dt><dd>{device.key}</dd>
        <dt>Firmware</dt><dd>{device.firmware}</dd>
        <dt>Info</dt><dd>{device.info}</dd>
      </dl>
    {:else}
      <p class="muted">Nicht verbunden. Per USB (Chrome/Edge, Web Serial) oder über den ESP32 am RS485-Port.</p>
    {/if}
  </section>

  <section>
    <h2>Konsole</h2>
    <form onsubmit={sendRaw}>
      <input bind:value={input} spellcheck="false" />
      <button type="submit" disabled={!client}>Senden</button>
    </form>
    <pre>{#each log as l}<span class={l.dir}>{l.dir === "tx" ? "→ " : "← "}{l.text}</span>
{/each}</pre>
  </section>
</main>

<footer>Forge DSP GUI NG {version} ({commit})</footer>

<style>
  header { display: flex; gap: .75rem; align-items: center; padding: .75rem 1rem; border-bottom: 1px solid var(--line); background: var(--card); flex-wrap: wrap; }
  h1 { font-size: 1.1rem; margin: 0 auto 0 0; }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  main { max-width: 60rem; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; min-width: 0; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: var(--mono); overflow-wrap: anywhere; }
  form { display: flex; gap: .5rem; }
  form input { flex: 1; min-width: 0; font-family: var(--mono); }
  pre { font: 13px/1.4 var(--mono); max-height: 22rem; overflow: auto; margin: .75rem 0 0; white-space: pre-wrap; }
  .tx { color: var(--accent); }
  .badge.ok { color: var(--ok); }
  .err { color: var(--err); margin: 0; }
  .muted { color: var(--muted); margin: 0; }
  .hint p { margin: 0; }
  footer { max-width: 60rem; margin: 0 auto; padding: 0 1rem 1rem; color: var(--muted); font-size: .8rem; }
</style>

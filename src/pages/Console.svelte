<script lang="ts">
  import { app, sendRaw } from "../lib/app.svelte";

  let input = $state("get.1 system.ping");
  let pre: HTMLPreElement | undefined = $state();
  $effect(() => {
    app.log.length;
    if (pre) pre.scrollTop = pre.scrollHeight;
  });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (input.trim()) sendRaw(input.trim());
  }
</script>

<header class="head">
  <h2>Konsole</h2>
  <p class="muted">Rohbefehle des Textprotokolls, z. B. <code>get.1 system.info</code>. Antworten fließen in die Oberfläche ein.</p>
</header>
<section class="panel box">
  <form onsubmit={submit}>
    <input bind:value={input} spellcheck="false" autocomplete="off" aria-label="Befehl" />
    <button class="primary" type="submit" disabled={app.status !== "online"}>Senden</button>
    <button type="button" onclick={() => (app.log.length = 0)}>Leeren</button>
  </form>
  <pre bind:this={pre} class="num">{#each app.log as l}<span class={l.dir}>{l.dir === "tx" ? "→ " : "← "}{l.text}</span>
{/each}</pre>
</section>

<style>
  .head { margin-bottom: 1rem; }
  code { font-family: var(--mono); font-size: .9em; }
  .box { padding: .85rem 1rem; display: flex; flex-direction: column; min-height: 0; flex: 1; }
  form { display: flex; gap: .5rem; }
  form input { flex: 1; min-width: 0; font-family: var(--mono); }
  pre { font-size: 12.5px; line-height: 1.5; flex: 1; min-height: 12rem; overflow: auto; margin: .75rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .tx { color: var(--accent); }
</style>

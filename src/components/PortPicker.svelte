<script lang="ts">
  import { listPorts, type PortInfo } from "../lib/transport/native";

  // Port choice in the desktop app (the browser shows its own dialog for Web Serial).
  let { ports, onpick, onrefresh }: { ports: PortInfo[]; onpick: (p: PortInfo | null) => void; onrefresh: () => void } = $props();
  let all = $state(false);
  const shown = $derived(listPorts(ports, all));
  const hidden = $derived(ports.length - listPorts(ports, false).length);
  const hex = (v: number | null) => (v === null ? "" : v.toString(16).padStart(4, "0"));
</script>

<div class="scrim" role="presentation" onclick={() => onpick(null)}></div>
<div class="panel picker" role="dialog" aria-modal="true" aria-label="Seriellen Anschluss wählen">
  <h3>Anschluss wählen</h3>
  {#if shown.length}
    <ul>
      {#each shown as p (p.name)}
        <li><button onclick={() => onpick(p)}>
          <strong>{p.product || (p.vid === null ? "Serieller Anschluss" : "USB-Seriell")}</strong>
          <span class="muted num">{p.name}{p.vid !== null ? ` · ${hex(p.vid)}:${hex(p.pid)}` : ""}</span>
          {#if p.vid === 0x10c4}<span class="tag">Forge (CP2102)</span>{/if}
        </button></li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Kein USB-Anschluss gefunden. Ist der Forge eingeschaltet und per USB verbunden?</p>
  {/if}
  <div class="row">
    {#if hidden > 0}<label class="check"><input type="checkbox" bind:checked={all} /> alle Anschlüsse zeigen ({hidden} weitere)</label>{/if}
    <span class="sp"></span>
    <button class="ghost" onclick={onrefresh}>Neu suchen</button>
    <button onclick={() => onpick(null)}>Abbrechen</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 50; }
  .picker { position: fixed; z-index: 51; left: 50%; top: 18%; transform: translateX(-50%); width: min(30rem, calc(100vw - 2rem));
    max-height: 64vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: .7rem; padding: 1rem; }
  h3 { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: .35rem; }
  li button { width: 100%; text-align: left; display: grid; gap: .1rem; padding: .55rem .7rem; border-radius: 9px; }
  li button:hover { border-color: var(--accent); }
  .tag { justify-self: start; font-size: .7rem; color: var(--accent); }
  .row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .sp { flex: 1; }
  .check { display: inline-flex; gap: .4rem; align-items: center; font-size: .82rem; color: var(--muted); }
</style>

<script lang="ts">
  import { t, tk, type Key } from "../lib/i18n/index.svelte";
  import { shortcuts } from "../lib/keys.svelte";

  // the overview of the keyboard shortcuts (#24): "?" or the link in the footer
  const GROUPS: { title: Key; rows: [string, Key][]; note?: Key }[] = [
    { title: tk("keys.global"), note: tk("keys.globalNote"), rows: [
      ["Strg+1 … 9", tk("keys.pages")], ["Strg+Z", tk("keys.undo")], ["Strg+Y / Strg+Shift+Z", tk("keys.redo")],
      ["Strg+Shift+L", tk("keys.reload")], ["Strg+Shift+S", tk("keys.saveFile")], ["Strg+Shift+D", tk("keys.connect")], ["?", tk("keys.overview")]] },
    { title: tk("keys.outputs"), rows: [["1 … 8", tk("keys.mute")], ["P + 1 … 8", tk("keys.phase")], ["M", tk("keys.muteAll")]] },
    { title: tk("keys.filters"), rows: [
      ["F1 … F8", tk("keys.channel")], ["F9 / F10", tk("keys.sums")], ["← / →", tk("keys.band")], ["↑ / ↓", tk("keys.gain")],
      ["F", tk("keys.freq")], ["Q", tk("keys.q")]] },
    { title: tk("keys.controls"), rows: [["← → ↑ ↓", tk("keys.step")], ["Shift", tk("keys.bigStep")], ["Doppelklick", tk("keys.dbl")]] },
  ];
  const close = () => (shortcuts.open = false);
</script>

<div class="scrim" role="presentation" onclick={close}></div>
<div class="panel dlg" role="dialog" aria-modal="true" aria-labelledby="keys-title">
  <div class="top"><h3 id="keys-title">{t("keys.title")}</h3><button class="ghost" onclick={close}>{t("app.close")}</button></div>
  <p class="muted small">{t("keys.intro")}</p>
  <div class="cols">
    {#each GROUPS as g}
      <section>
        <h4>{t(g.title)}</h4>
        <table><tbody>
          {#each g.rows as [k, what]}<tr><td><kbd>{k.replace("Strg", t("keys.ctrl")).replace("Doppelklick", t("keys.doubleClick"))}</kbd></td><td>{t(what)}</td></tr>{/each}
        </tbody></table>
        {#if g.note}<p class="muted small">{t(g.note)}</p>{/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); z-index: 60; }
  .dlg { position: fixed; z-index: 61; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(52rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem); overflow: auto; padding: 1rem 1.2rem; display: grid; gap: .5rem; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  h3 { margin: 0; }
  h4 { margin: .2rem 0 .3rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .cols { display: grid; gap: .5rem 1.5rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; }
  td { padding: .22rem .3rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  td:first-child { white-space: nowrap; width: 1%; }
  kbd { font-family: var(--mono); font-size: .8rem; padding: .05rem .35rem; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--raised); }
  .small { font-size: .78rem; margin: .3rem 0 0; }
</style>

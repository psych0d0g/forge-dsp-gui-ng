<script lang="ts">
  let { title, text, issue }: { title: string; text: string; issue: number } = $props();
</script>

<header class="head"><h2>{title}</h2></header>
<section class="panel box">
  <p>{text}</p>
  <p class="muted">Diese Seite ist in Arbeit
    (<a href="https://github.com/psych0d0g/forge-dsp-gui-ng/issues/{issue}" target="_blank" rel="noreferrer">Issue #{issue}</a>).
    Bis dahin gehen alle Einstellungen über die Konsole.</p>
</section>

<style>
  .head { margin-bottom: 1rem; }
  .box { padding: 1.25rem; display: grid; gap: .6rem; max-width: 46rem; }
  a { color: var(--accent); }
</style>

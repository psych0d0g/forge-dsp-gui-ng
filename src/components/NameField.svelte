<script lang="ts">
  import { t } from "../lib/i18n/index.svelte";
  // A channel name that can be edited in place: looks like text, becomes a field on hover/focus.
  let { value, placeholder, label, onchange }:
    { value: string; placeholder: string; label: string; onchange: (name: string) => void } = $props();
</script>

<input class="name" {value} {placeholder} aria-label={label} title={t("ui.rename")} maxlength="16" spellcheck="false"
  onchange={(e) => onchange(e.currentTarget.value)}
  onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />

<style>
  .name { width: 100%; min-width: 0; border: 1px solid transparent; background: none; padding: .2rem .35rem; margin-left: -.35rem;
    border-radius: 6px; font: inherit; color: var(--fg); text-overflow: ellipsis; }
  .name::placeholder { color: var(--fg); opacity: 1; }
  .name:hover { border-color: var(--line-strong); }
  .name:focus { border-color: var(--accent); background: var(--raised); outline: none; }
  .name:focus::placeholder { color: var(--faint); }
</style>

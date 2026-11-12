<script lang="ts">
  import { app, write } from "../lib/app.svelte";
  import Fader from "../components/Fader.svelte";
  import Icon from "../components/Icon.svelte";

  const d = $derived(app.device);
  const pairs = $derived(Array.from({ length: Math.ceil(d.gain.out.length / 2) }, (_, i) => [2 * i + 1, 2 * i + 2]));
  let linked = $state<Record<number, boolean>>({});

  function gain(ch: number, raw: number, pair: number) {
    const delta = raw - d.gain.out[ch - 1];
    for (const c of linked[pair] ? [2 * pair + 1, 2 * pair + 2] : [ch]) {
      const sc = d.scales.out!;
      const v = c === ch ? raw : Math.min(sc.max, Math.max(sc.min, d.gain.out[c - 1] + delta));
      d.gain.out[c - 1] = v;
      write(`gain.out.${c}`, v);
    }
  }
  function toggle(kind: "mute" | "phase", ch: number) {
    const v = d[kind][ch - 1] ? 0 : 1;
    d[kind][ch - 1] = v;
    write(`${kind}.out.${ch}`, v);
  }
</script>

<header class="head">
  <div><h2>Ausgänge</h2><p class="muted">Pegel, Stummschaltung und Polarität je Kanal. Doppelklick auf einen Regler setzt 0 dB.</p></div>
</header>

{#if d.scales.out}
  <div class="pairs">
    {#each pairs as [a, b], p}
      <section class="panel pair">
        <div class="pairhead">
          <h3>Paar {p + 1}</h3>
          <button class="ghost link" class:on={linked[p]} title="Beide Kanäle gemeinsam verstellen"
            aria-pressed={!!linked[p]} onclick={() => (linked[p] = !linked[p])}><Icon name="link" size={15} /> gekoppelt</button>
        </div>
        {#each [a, b] as ch}
          {#if ch <= d.gain.out.length}
            <div class="row">
              <span class="chn num">{ch}</span>
              <span class="name" title={d.channelNames[ch] || ""}>{d.channelNames[ch] || `Ausgang ${ch}`}</span>
              <Fader value={d.gain.out[ch - 1]} scale={d.scales.out} dim={!!d.mute[ch - 1]} label="Pegel Ausgang {ch}"
                onchange={(raw) => gain(ch, raw, p)} />
              <button class="sw mute" class:on={!!d.mute[ch - 1]} aria-pressed={!!d.mute[ch - 1]} title="Stumm"
                onclick={() => toggle("mute", ch)}>M</button>
              <button class="sw" class:on={!!d.phase[ch - 1]} aria-pressed={!!d.phase[ch - 1]} title="Polarität drehen (180°)"
                onclick={() => toggle("phase", ch)}>Ø</button>
            </div>
          {/if}
        {/each}
      </section>
    {/each}
  </div>
{:else}
  <p class="muted">Dieses Gerät meldet keine Skala für die Ausgangspegel.</p>
{/if}

<style>
  .head { margin-bottom: 1rem; }
  .pairs { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr)); }
  .pair { padding: .85rem 1rem; display: grid; gap: .35rem; }
  .pairhead { display: flex; justify-content: space-between; align-items: center; }
  .link { display: inline-flex; gap: .35rem; align-items: center; font-size: .8rem; color: var(--muted); padding: .2rem .5rem; }
  .link.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .row { display: flex; align-items: center; gap: .65rem; min-width: 0; }
  .chn { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 6px; background: var(--raised); color: var(--muted); font-size: .8rem; flex: none; }
  .name { width: 7.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
  .sw { width: 2rem; height: 2rem; padding: 0; font-weight: 650; flex: none; color: var(--muted); }
  .sw.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--accent); }
  .sw.mute.on { background: color-mix(in srgb, var(--err) 22%, transparent); border-color: var(--err); color: var(--err); }
  /* narrow: name and switches on one line, the fader below at full width */
  @media (max-width: 40rem) {
    .row { display: grid; grid-template: "n name m p" auto "f f f f" auto / auto 1fr auto auto; gap: .1rem .5rem; padding: .25rem 0; }
    .name { width: auto; }
    .row :global(.fader) { grid-area: f; }
  }
</style>

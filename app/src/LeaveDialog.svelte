<script lang="ts">
  let { name, saving, onsave, ondiscard, oncancel }: { name: string; saving: boolean; onsave: () => void; ondiscard: () => void; oncancel: () => void } = $props()
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && oncancel()} />

<div class="backdrop" role="presentation" onclick={oncancel}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Speichern oder verwerfen?" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={() => {}}>
    <h2>Speichern oder verwerfen?</h2>
    <p>„{name}“</p>
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" onclick={onsave} disabled={saving} autofocus>Speichern</button>
      <button class="danger" onclick={ondiscard} disabled={saving}>Verwerfen</button>
      <button onclick={oncancel}>Abbrechen</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(20, 24, 32, 0.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .dialog { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 18px 22px; min-width: 20rem; max-width: 90vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2); }
  h2 { margin: 0 0 6px; font-size: 1.1rem; }
  p { margin: 0 0 14px; }
  .row { display: flex; gap: 8px; }
</style>

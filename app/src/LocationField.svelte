<script lang="ts">
  let { value, onchange }: { value?: { lat: number; lon: number }; onchange: (value: { lat: number | null; lon: number | null }) => void } = $props()

  // Kept here: with only one of the two filled in the entry has no location yet, and the other must not vanish.
  // svelte-ignore state_referenced_locally
  let lat = $state(value?.lat ?? null)
  // svelte-ignore state_referenced_locally
  let lon = $state(value?.lon ?? null)
  const emit = () => onchange({ lat, lon })
</script>

<div class="pair">
  <label>Breite <input type="number" step="any" min="-90" max="90" bind:value={lat} oninput={emit} /></label>
  <label>Länge <input type="number" step="any" min="-180" max="180" bind:value={lon} oninput={emit} /></label>
</div>

<style>
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-width: 24rem; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--muted); }
</style>

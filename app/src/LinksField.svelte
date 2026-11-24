<script lang="ts">
  import { untrack } from 'svelte'

  type Link = { label: string; url: string }
  let { value, onchange }: { value: Link[]; onchange: (links: Link[]) => void } = $props()

  // The rows are kept here: a new empty row (or one with only a label so far) must stay while it is being filled in.
  // svelte-ignore state_referenced_locally
  // Without links there is one empty row to start with, so that a link can be written at once.
  let rows = $state<Link[]>(value.length > 0 ? value.map((l) => ({ ...l })) : [{ label: '', url: '' }])
  const emit = () => onchange(rows.map((r) => ({ ...r })))

  // Changed from outside (the assistant filled it in): what the entry has is shown. Rows that are not complete yet are not the entry's, they stay.
  const norm = (links: Link[]) => JSON.stringify(links.map((l) => [l.label.trim(), l.url.trim()]))
  $effect(() => {
    const links = value
    untrack(() => {
      const complete = rows.filter((r) => r.label.trim() && r.url.trim())
      if (norm(links) !== norm(complete)) rows = links.length > 0 ? links.map((l) => ({ ...l })) : [{ label: '', url: '' }]
    })
  })
</script>

<div class="rows">
  {#each rows as row, i}
    <div class="row">
      <input type="text" placeholder="Bezeichnung" bind:value={row.label} oninput={emit} />
      <input type="url" placeholder="https://..." bind:value={row.url} oninput={emit} />
      <button type="button" title="Entfernen" onclick={() => { rows.splice(i, 1); emit() }}>×</button>
    </div>
  {/each}
  <button type="button" onclick={() => rows.push({ label: '', url: '' })}>+ Link</button>
</div>

<style>
  .rows { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 6px; width: 100%; }
</style>

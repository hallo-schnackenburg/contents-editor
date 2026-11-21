<script lang="ts">
  import { MODEL, type EntryType } from '@contents-editor/core'
  import { groups, isDirty, titleOf } from './logic.js'
  import type { Workspace } from './workspace.svelte.js'

  let { ws }: { ws: Workspace } = $props()

  let filter = $state('')
  let creating = $state(false)
  let type = $state<EntryType>('person')
  let label = $state('')
  let topic = $state('')
  let problem = $state<string>()

  // Media need a file; uploading comes later, so new ones cannot be made yet.
  const creatable = (Object.keys(MODEL.types) as EntryType[]).filter((t) => MODEL.types[t].class !== 'media')
  const nameLabel = $derived(MODEL.types[type].class === 'content' ? 'Titel' : 'Name')
  const listed = $derived(groups(ws.entries, filter))

  function create(event: Event) {
    event.preventDefault()
    problem = undefined
    try {
      ws.create(type, label, topic)
      creating = false
      label = ''
    } catch (error) {
      problem = (error as Error).message
    }
  }
</script>

<aside>
  <div class="tools">
    <input type="text" placeholder="Suchen ..." bind:value={filter} />
    <button class="primary" onclick={() => (creating = !creating)}>Neu</button>
  </div>
  {#if creating}
    <form onsubmit={create}>
      <label>Art
        <select bind:value={type}>
          {#each creatable as t}<option value={t}>{MODEL.types[t].label}</option>{/each}
        </select>
      </label>
      <label>{nameLabel}
        <input type="text" bind:value={label} required />
      </label>
      {#if MODEL.types[type].class === 'content'}
        <label>Thema (Ordner)
          <input type="text" bind:value={topic} placeholder="traditionen" />
        </label>
      {/if}
      {#if problem}<p class="error-box">{problem}</p>{/if}
      <div class="row"><button class="primary" type="submit">Anlegen</button><button type="button" onclick={() => (creating = false)}>Abbrechen</button></div>
    </form>
  {/if}
  <div class="list">
    {#each listed as group}
      <h2>{group.label} <span class="muted">{group.entries.length}</span></h2>
      <ul>
        {#each group.entries as entry (entry.path)}
          <li>
            <button class:active={ws.selectedPath === entry.path} onclick={() => ws.select(entry.path)}>
              <span>{titleOf(entry)}</span>
              {#if isDirty(entry)}<span class="dot" title="Nicht gespeichert">●</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{ws.loading ? 'Lädt ...' : 'Nichts gefunden.'}</p>
    {/each}
  </div>
</aside>

<style>
  aside { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; }
  .tools { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid var(--line); }
  form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-bottom: 1px solid var(--line); background: var(--wash); }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--muted); }
  .row { display: flex; gap: 8px; }
  .list { overflow: auto; padding: 6px 10px 12px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 14px 0 4px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li button { display: flex; justify-content: space-between; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 5px 8px; background: none; }
  li button:hover { background: var(--wash); }
  li button.active { background: var(--accent-wash); color: var(--accent); }
  .dot { color: var(--bad); }
  p { margin: 8px 0; }
</style>

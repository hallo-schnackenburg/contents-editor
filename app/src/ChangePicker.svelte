<script lang="ts">
  import type { Change } from './api.js'
  import type { Workspace } from './workspace.svelte.js'

  let { ws }: { ws: Workspace } = $props()

  let creating = $state(false)
  let name = $state('')
  let problem = $state<string>()

  const label = (c: Change) => `${c.name}${c.state === 'draft' ? '' : ' (eingereicht)'}`
  const open = $derived(ws.changes.filter((c) => c.state === 'draft' || c.state === 'submitted'))
  const mine = $derived(open.filter((c) => c.author === ws.user?.login))
  const others = $derived(open.filter((c) => c.author !== ws.user?.login))
  /** The change that is worked on may be one that is not in the lists (closed). */
  const unlisted = $derived(ws.branch !== undefined && !open.some((c) => c.branch === ws.branch) && !ws.pending.some((p) => p.branch === ws.branch) ? ws.changes.find((c) => c.branch === ws.branch) : undefined)

  /** Nothing may be lost by leaving: what is not saved belongs to the change that is left. */
  const mayLeave = () => ws.dirty.length === 0 || confirm(`${ws.dirty.length} nicht gespeicherte Änderung(en) gehen verloren, wenn du die Änderung wechselst. Trotzdem wechseln?`)

  async function choose(event: Event & { currentTarget: HTMLSelectElement }) {
    const select = event.currentTarget
    if (!mayLeave()) {
      select.value = ws.branch ?? ''
      return
    }
    await ws.switchTo(select.value || undefined)
  }

  async function create(event: Event) {
    event.preventDefault()
    problem = undefined
    if (!mayLeave()) return
    try {
      await ws.startChange(name)
      creating = false
      name = ''
    } catch (error) {
      problem = (error as Error).message
    }
  }
</script>

<div class="picker">
  <label class="muted" for="change">Änderung</label>
  <select id="change" value={ws.branch ?? ''} onchange={choose}>
    <option value="">Keine (nur lesen)</option>
    {#if ws.pending.length}
      <optgroup label="Neu, noch nichts gespeichert">
        {#each ws.pending as p}<option value={p.branch}>{p.name}</option>{/each}
      </optgroup>
    {/if}
    {#if mine.length}
      <optgroup label="Meine">
        {#each mine as c (c.number)}<option value={c.branch}>{label(c)}</option>{/each}
      </optgroup>
    {/if}
    {#if others.length}
      <optgroup label="Von anderen">
        {#each others as c (c.number)}<option value={c.branch}>{label(c)} · {c.author}</option>{/each}
      </optgroup>
    {/if}
    {#if unlisted}<option value={unlisted.branch}>{unlisted.name} (abgeschlossen)</option>{/if}
  </select>
  <button onclick={() => (creating = !creating)}>Neue Änderung</button>
</div>
{#if creating}
  <form class="new" onsubmit={create}>
    <input type="text" bind:value={name} placeholder="Name, z. B. Osterfeuer 2027" required />
    <button class="primary" type="submit">Anlegen</button>
    <button type="button" onclick={() => (creating = false)}>Abbrechen</button>
    {#if problem}<span class="problem">{problem}</span>{/if}
  </form>
{/if}

<style>
  .picker { display: flex; align-items: center; gap: 8px; }
  select { width: auto; max-width: 20rem; }
  .new { display: flex; gap: 8px; align-items: center; flex-basis: 100%; }
  .new input { max-width: 22rem; }
  .problem { color: var(--bad); font-size: 13px; }
</style>

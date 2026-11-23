<script lang="ts">
  import { onMount } from 'svelte'
  import type { Workspace } from './workspace.svelte.js'

  let { ws, ondone, oncancel }: { ws: Workspace; ondone: (folder: string) => void; oncancel: () => void } = $props()

  let name = $state('')
  let input = $state<HTMLInputElement>()
  onMount(() => input?.focus())
  let problem = $state<string>()

  async function submit(event: Event) {
    event.preventDefault()
    problem = undefined
    try {
      ondone(await ws.createTopic(name))
    } catch (error) {
      problem = (error as Error).message
    }
  }
</script>

<form class="new" onsubmit={submit} aria-label="Neues Thema">
  <h1>Neues Thema</h1>
  <label>
    Name
    <input type="text" bind:this={input} bind:value={name} placeholder="z. B. Natur &amp; Umwelt" required />
  </label>
  {#if problem}<p class="error-box">{problem}</p>{/if}
  <div class="row">
    <button class="primary" type="submit" disabled={ws.saving}>Anlegen</button>
    <button type="button" onclick={oncancel}>Abbrechen</button>
  </div>
</form>

<style>
  .new { padding: 18px 22px 28px; max-width: 34rem; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 1.35rem; }
  label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
  .row { display: flex; gap: 8px; }
</style>

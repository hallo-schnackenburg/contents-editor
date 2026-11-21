<script lang="ts">
  import type { Workspace } from './workspace.svelte.js'
  import Sidebar from './Sidebar.svelte'
  import EntryForm from './EntryForm.svelte'

  let { ws }: { ws: Workspace } = $props()

  // Unsaved changes are only in this browser tab: leaving the page would lose them.
  $effect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (ws.dirty.length > 0) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })
</script>

<div class="app">
  <header>
    <strong>Contents Editor</strong>
    {#if ws.branch}
      <span class="muted branch" title={ws.own ? 'Deine Änderungen liegen auf diesem Branch.' : 'Noch nichts gespeichert: das hier ist der Stand von main.'}>{ws.branch}{ws.own ? '' : ' (noch nicht angelegt)'}</span>
    {/if}
    <span class="spacer"></span>
    {#if ws.dirty.length > 0}<span class="unsaved">{ws.dirty.length} nicht gespeichert</span>{/if}
    <button onclick={() => void ws.load()} disabled={ws.loading}>{ws.loading ? 'Lädt ...' : 'Neu laden'}</button>
    <span class="muted">{ws.user?.name}</span>
    <button onclick={() => void ws.logout()}>Abmelden</button>
  </header>
  {#if ws.error}
    <div class="error-box banner">{ws.error} <button class="link" onclick={() => (ws.error = undefined)}>Schließen</button></div>
  {/if}
  <div class="panes">
    <Sidebar {ws} />
    <section class="detail">
      {#if ws.selected}
        {#key ws.selected.path}<EntryForm {ws} />{/key}
      {:else}
        <p class="muted empty">Links einen Eintrag wählen oder einen neuen anlegen.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .branch { font-size: 13px; }
  .spacer { flex: 1; }
  .unsaved { color: var(--bad); font-size: 13px; }
  .banner { margin: 8px 16px 0; }
  .panes { flex: 1; display: grid; grid-template-columns: 22rem 1fr; gap: 12px; padding: 12px 16px; min-height: 0; }
  .detail { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; overflow: auto; }
  .empty { padding: 24px; }
</style>

<script lang="ts">
  import type { Workspace } from './workspace.svelte.js'
  import Sidebar from './Sidebar.svelte'
  import EntryForm from './EntryForm.svelte'
  import ChangePicker from './ChangePicker.svelte'
  import Changes from './Changes.svelte'

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
    <nav>
      <button class:on={ws.view === 'database'} onclick={() => (ws.view = 'database')}>Datenbank</button>
      <button class:on={ws.view === 'changes'} onclick={() => (ws.view = 'changes')}>
        Änderungen{#if ws.review.count.waiting > 0}<span class="badge" title="Warten auf Übernahme">{ws.review.count.waiting}</span>{/if}
      </button>
    </nav>
    <ChangePicker {ws} />
    <span class="spacer"></span>
    {#if ws.dirty.length > 0}<span class="unsaved">{ws.dirty.length} nicht gespeichert</span>{/if}
    <span class="live" class:on={ws.liveOpen} title={ws.liveOpen ? 'Live verbunden' : 'Keine Live-Verbindung: es wird alle Minute nachgefragt.'}>●</span>
    <button onclick={() => void ws.reload()} disabled={ws.loading}>{ws.loading ? 'Lädt ...' : 'Neu laden'}</button>
    <span class="muted">{ws.user?.name}</span>
    <button onclick={() => void ws.logout()}>Abmelden</button>
  </header>
  {#if ws.error}
    <div class="error-box banner">{ws.error} <button class="link" onclick={() => (ws.error = undefined)}>Schließen</button></div>
  {/if}
  {#if ws.view === 'changes'}
    <Changes {ws} />
  {:else}
    {#if ws.readonlyReason}
      <div class="note banner">{ws.readonlyReason}</div>
    {/if}
    <div class="panes">
      <Sidebar {ws} />
      <section class="detail">
        {#if ws.selected}
          {#key ws.selected.path}<EntryForm {ws} />{/key}
        {:else}
          <p class="muted empty">Links einen Eintrag wählen{ws.editable ? ' oder einen neuen anlegen' : ''}.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 8px 16px; background: var(--paper); border-bottom: 1px solid var(--line); }
  nav { display: flex; gap: 4px; }
  nav button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; }
  nav button.on { background: var(--accent-wash); color: var(--accent); }
  .badge { margin-left: 6px; background: var(--accent); color: #fff; border-radius: 999px; padding: 0 7px; font-size: 12px; }
  .spacer { flex: 1; }
  .unsaved { color: var(--bad); font-size: 13px; }
  .live { color: var(--line); font-size: 12px; }
  .live.on { color: var(--ok); }
  .banner { margin: 8px 16px 0; }
  .note { background: var(--accent-wash); color: var(--accent); border-radius: 6px; padding: 8px 12px; }
  .panes { flex: 1; display: grid; grid-template-columns: 22rem 1fr; gap: 12px; padding: 12px 16px; min-height: 0; }
  .detail { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; overflow: auto; }
  .empty { padding: 24px; }
</style>

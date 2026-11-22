<script lang="ts">
  import type { Change } from './api.js'
  import type { Workspace } from './workspace.svelte.js'

  let { ws }: { ws: Workspace } = $props()

  // The changes to choose from: new ones (nothing saved yet), mine, and those of others. Open ones only.
  const open = $derived(ws.changes.filter((c) => c.state === 'draft' || c.state === 'submitted'))
  const mine = $derived(open.filter((c) => c.author === ws.user?.login))
  const others = $derived(open.filter((c) => c.author !== ws.user?.login))
  /** The change that is worked on may be one that is finished: it stays in the list while it is shown. */
  const unlisted = $derived(ws.branch !== undefined && !open.some((c) => c.branch === ws.branch) && !ws.pending.some((p) => p.branch === ws.branch) ? ws.changes.find((c) => c.branch === ws.branch) : undefined)

  /** Nothing may be lost by leaving: what is not saved belongs to the change that is left. */
  const mayLeave = () => ws.dirty.length === 0 || confirm(`${ws.dirty.length} nicht gespeicherte Änderung(en) gehen verloren, wenn du die Änderung wechselst. Trotzdem wechseln?`)

  async function choose(branch: string) {
    if (!mayLeave()) return
    await ws.switchTo(branch === ws.branch ? undefined : branch)
  }

  // A new change
  let starting = $state(false)
  let changeName = $state('')
  let startProblem = $state<string>()
  async function start(event: Event) {
    event.preventDefault()
    startProblem = undefined
    if (!mayLeave()) return
    try {
      await ws.startChange(changeName)
      starting = false
      changeName = ''
    } catch (error) {
      startProblem = (error as Error).message
    }
  }

  const stateLabel = (c: Change) => (c.state === 'draft' ? 'Entwurf' : c.state === 'submitted' ? 'Eingereicht' : c.state === 'merged' ? 'Übernommen' : 'Geschlossen')
</script>

{#snippet change(branch: string, name: string, meta: string, c?: Change)}
  <li class:on={ws.branch === branch}>
    <button class="head" onclick={() => choose(branch)} aria-expanded={ws.branch === branch}>
      <span class="twist">{ws.branch === branch ? '▾' : '▸'}</span>
      <span class="what"><span class="t">{name}</span><span class="muted h">{meta}</span></span>
      {#if c}<span class="state {c.state}">{stateLabel(c)}</span>{/if}
    </button>
    {#if ws.branch === branch}
      <div class="body">
        {#if !ws.editable}<p class="muted small">Diese Änderung ist abgeschlossen: nur ansehen.</p>{/if}
        {#if ws.remote}<button class="link review" onclick={() => ws.openChange(ws.remote!.number)}>Ansehen, einreichen, kommentieren →</button>{/if}
      </div>
    {/if}
  </li>
{/snippet}

<aside>
  <div class="tools">
    <strong>Änderungen</strong>
    <button class="primary" onclick={() => (starting = !starting)}>+ Neu</button>
  </div>
  {#if starting}
    <form class="form" onsubmit={start}>
      <input type="text" bind:value={changeName} placeholder="Name, z. B. Osterfeuer 2027" required />
      {#if startProblem}<p class="error-box">{startProblem}</p>{/if}
      <div class="row"><button class="primary" type="submit">Anlegen</button><button type="button" onclick={() => (starting = false)}>Abbrechen</button></div>
    </form>
  {/if}
  <div class="list">
    {#if ws.pending.length > 0}
      <h2>Neu, noch nichts gespeichert</h2>
      <ul>{#each ws.pending as p (p.branch)}{@render change(p.branch, p.name, ws.user?.login ?? '')}{/each}</ul>
    {/if}
    {#if mine.length > 0}
      <h2>Meine</h2>
      <ul>{#each mine as c (c.number)}{@render change(c.branch, c.name, `#${c.number}`, c)}{/each}</ul>
    {/if}
    {#if others.length > 0}
      <h2>Von anderen</h2>
      <ul>{#each others as c (c.number)}{@render change(c.branch, c.name, `${c.author} · #${c.number}`, c)}{/each}</ul>
    {/if}
    {#if unlisted}
      <h2>Abgeschlossen</h2>
      <ul>{@render change(unlisted.branch, unlisted.name, `#${unlisted.number}`, unlisted)}</ul>
    {/if}
    {#if open.length === 0 && ws.pending.length === 0 && !unlisted}
      <p class="muted pad">Noch keine Änderung. Lege mit „+ Neu“ eine an.</p>
    {/if}
  </div>
</aside>

<style>
  aside { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; }
  .tools { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--line); }
  .list { overflow: auto; padding: 4px 10px 14px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 14px 0 4px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li.on { background: var(--wash); border-radius: 8px; }
  .head { display: flex; gap: 6px; align-items: center; width: 100%; text-align: left; border: 0; background: none; padding: 7px 8px; }
  li.on > .head { font-weight: 600; }
  .twist { width: 12px; color: var(--muted); font-size: 11px; flex: none; }
  .what { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h { font-size: 12px; font-weight: 400; }
  .small { font-size: 12px; }
  .state { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #e4e7ec; color: #344054; font-weight: 400; }
  .state.submitted { background: var(--accent-wash); color: var(--accent); }
  .body { padding: 0 8px 10px 20px; display: flex; flex-direction: column; gap: 8px; }
  .form { display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--wash); border-bottom: 1px solid var(--line); }
  .row { display: flex; gap: 8px; }
  .review { text-align: left; font-size: 13px; }
  p { margin: 4px 0; }
  .pad { padding: 10px; }
</style>

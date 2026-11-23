<script lang="ts">
  import { MODEL } from '@contents-editor/core'
  import { titleOf, typeOf } from './logic.js'
  import { defaultName, type Workspace } from './workspace.svelte.js'

  let { ws, onopen }: { ws: Workspace; onopen: (path: string) => void } = $props()

  // The name of the draft: shown as it is (or as it will be), a change takes effect when the field is left.
  let typed = $state<string>()
  let problem = $state<string>()
  const shown = $derived(typed ?? ws.draft?.name ?? defaultName())

  const blocked = $derived(ws.problems.size > 0)
  const canSubmit = $derived(ws.editable && ws.draft !== undefined && !blocked && !ws.saving)

  async function leftName() {
    if (typed === undefined) return
    const name = typed
    typed = undefined
    await ws.rename(name)
  }

  /** The id of an entry as it shows in a list: its path without the type folder and the ending. */
  const idPart = (path = '') => path.split('/').slice(2).join('/').replace(/\.yaml$/, '')

  function discard(path: string, kind: string, title: string) {
    if (kind === 'removed' || confirm(kind === 'renamed' ? `Die Umbenennung von „${title}“ verwerfen (mit allem, was dazugehört)?` : `Die Änderung an „${title}“ verwerfen?`)) void ws.discard(path)
  }

  async function submit(event: Event) {
    event.preventDefault()
    problem = undefined
    await leftName()
    if (await ws.submit()) ws.review.filter = 'waiting'
    else problem = ws.error
  }
</script>

<div class="pane">
  <div class="list">
    {#each ws.changes as change (change.kind + change.entry.path)}
      {@const type = typeOf(change.entry)}
      {@const issues = ws.problems.get(change.entry.path)}
      <div class="item" class:on={ws.selectedPath === change.entry.path}>
        <button class="open" disabled={change.kind === 'removed'} onclick={() => onopen(change.entry.path)}>
          <span class="what">
            <span class="t" class:gone={change.kind === 'removed'}>{titleOf(change.entry)}</span>
            <span class="muted h">{type ? MODEL.types[type].label : ''}{#if change.kind === 'renamed'} · {idPart(change.from)} → {idPart(change.entry.path)}{#if change.moved}, {change.moved} darunter{/if}{#if change.references}, {change.references} Verweis{change.references > 1 ? 'e' : ''}{/if}{/if}{#if issues} · <span class="bad" title={issues.map((i) => i.message).join('\n')}>{issues.length} Problem{issues.length > 1 ? 'e' : ''}</span>{/if}</span>
          </span>
        </button>
        <button class="x" title={change.kind === 'removed' ? 'Wieder herstellen' : 'Änderung verwerfen'} aria-label="Verwerfen" onclick={() => discard(change.entry.path, change.kind, titleOf(change.entry))}>{change.kind === 'removed' ? '↺' : '×'}</button>
      </div>
    {/each}
  </div>

  <form class="commit" onsubmit={submit}>
    <input type="text" value={shown} oninput={(e) => (typed = e.currentTarget.value)} onblur={leftName} placeholder={defaultName()} aria-label="Name der Einreichung" disabled={!ws.editable} />
    {#if blocked}<p class="small bad">Erst die Probleme beheben ({ws.problems.size}).</p>{/if}
    {#if problem}<p class="error-box small">{problem}</p>{/if}
    <button class="primary" type="submit" disabled={!canSubmit}>{ws.saving ? 'Speichert ...' : 'Einreichen'}</button>
  </form>
</div>

<style>
  .pane { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .list { overflow: auto; flex: 1; padding: 4px 6px; }
  .item { display: flex; align-items: center; border-radius: 6px; }
  .item:hover { background: var(--wash); }
  .item.on { background: var(--accent-wash); }
  .item > button { border: 0; background: none; padding: 5px 6px; }
  .open { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0; text-align: left; }
  .x { flex: none; color: var(--muted); font-size: 16px; line-height: 1; opacity: 0; }
  .item:hover .x, .x:focus-visible { opacity: 1; }
  .what { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t.gone { text-decoration: line-through; color: var(--muted); }
  .h { font-size: 12px; }
  .bad { color: var(--bad); }
  .small { font-size: 12px; }
  .commit { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-top: 1px solid var(--line); }
  .commit p { margin: 0; }
</style>

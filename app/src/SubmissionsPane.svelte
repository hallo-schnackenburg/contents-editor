<script lang="ts">
  import { untrack } from 'svelte'
  import type { SubmissionState } from './api.js'
  import type { Action, Filter } from './review.svelte.js'
  import ChangesPane from './ChangesPane.svelte'
  import type { Workspace } from './workspace.svelte.js'

  // The submissions of everybody (a pull request each): three lists, and for the one that is open what can be done with it.
  // What it does is shown in the middle (SubmissionDetail).
  let { ws, onopen, onopenchange }: { ws: Workspace; onopen?: () => void; onopenchange: (path: string) => void } = $props()
  const review = $derived(ws.review)

  const FILTERS = [
    ['waiting', 'Eingereicht'],
    ['drafts', 'Entwürfe'],
    ['done', 'Angenommen'],
  ] as const
  const STATE: Record<SubmissionState, string> = { draft: 'Entwurf', submitted: 'Eingereicht', merged: 'Angenommen', closed: 'Verworfen' }

  // "Neu" is the person's own draft, as long as it has changes; the others are lists of submissions. A tab is only there if it has something.
  const tabs = $derived([
    ...(ws.changes.length > 0 ? [['new', 'Neu', ws.changes.length] as const] : []),
    ...FILTERS.filter(([key]) => review.count[key] > 0).map(([key, label]) => [key, label, review.count[key]] as const),
  ])
  let chosen = $state<'new' | Filter>()
  const tab = $derived(tabs.some(([key]) => key === chosen) ? chosen! : (tabs[0]?.[0] ?? 'new'))
  let had = untrack(() => ws.changes.length)
  // The first change brings the person to "Neu".
  $effect(() => {
    const count = ws.changes.length
    if (count > 0 && had === 0) chosen = 'new'
    had = count
  })
  // A submission that moved to another list is followed.
  let seen = untrack(() => review.filter)
  $effect(() => {
    const filter = review.filter
    if (filter !== seen) {
      seen = filter
      chosen = filter
    }
  })

  let asking = $state<Action>()
  let renaming = $state(false)
  let name = $state('')

  const when = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { dateStyle: 'short' })

  // Whatever was asked for belongs to the submission that was open.
  $effect(() => {
    void review.selected
    asking = undefined
    renaming = false
  })

  function toggle(number: number) {
    if (review.selected === number) void review.select(undefined)
    else {
      void review.select(number)
      onopen?.()
    }
  }

  async function confirm(action: Action) {
    await review.act(action)
    asking = undefined
  }

  function startRename() {
    name = review.submission?.name ?? ''
    renaming = true
  }

  async function rename(event: Event) {
    event.preventDefault()
    if (await review.rename(name)) renaming = false
  }
</script>

<aside>
  {#if tabs.length > 0}
    <nav>
      {#each tabs as [key, label, count]}
        <button class:on={tab === key} onclick={() => { if (key !== 'new') review.filter = key; chosen = key }}>{label} <span class="count">{count}</span></button>
      {/each}
    </nav>
  {/if}
  {#if tab === 'new' && ws.changes.length > 0}
    <ChangesPane {ws} onopen={onopenchange} />
  {:else}
  <ul>
    {#each review.shown as submission (submission.number)}
      {@const open = review.selected === submission.number}
      <li class:open>
        <button class="card" onclick={() => toggle(submission.number)}>
          <span class="name">{submission.name}</span>
          <span class="meta muted"><span>{submission.author} · {when(submission.updated)}</span><span>{STATE[submission.state]}</span></span>
        </button>
        {#if open}
          <div class="actions">
            {#if renaming}
              <form onsubmit={rename}>
                <input type="text" bind:value={name} maxlength="100" aria-label="Name der Einreichung" />
                <button class="primary" type="submit" disabled={!name.trim()}>Speichern</button>
                <button type="button" onclick={() => (renaming = false)}>Abbrechen</button>
              </form>
            {:else if asking}
              <span>{asking === 'merge' ? 'Einreichung annehmen?' : asking === 'close' ? 'Einreichung verwerfen, ohne sie anzunehmen?' : 'Entwurf zur Übernahme einreichen?'}</span>
              <button class="primary" onclick={() => void confirm(asking!)} disabled={!!review.acting}>{review.acting ? 'Einen Moment ...' : 'Ja'}</button>
              <button onclick={() => (asking = undefined)} disabled={!!review.acting}>Nein</button>
            {:else}
              {#if submission.state === 'draft'}<button class="primary" onclick={() => (asking = 'submit')}>Einreichen</button>{/if}
              {#if submission.state === 'submitted'}
                <span title={review.blocked ?? ''}><button class="primary" disabled={!!review.blocked} onclick={() => (asking = 'merge')}>Annehmen</button></span>
              {/if}
              {#if submission.state === 'draft' || submission.state === 'submitted'}
                <button onclick={startRename}>Umbenennen</button>
                <button class="danger" onclick={() => (asking = 'close')}>Verwerfen</button>
              {/if}
              <a href={submission.url} target="_blank" rel="noreferrer">Auf GitHub ansehen</a>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {/if}
</aside>

<style>
  aside { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; flex: 1; }
  nav { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid var(--line); }
  nav button { flex: 1; border: 0; background: none; padding: 4px 6px; border-radius: 6px; white-space: nowrap; }
  nav button.on { background: var(--accent-wash); color: var(--accent); }
  .count { font-size: 12px; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 6px; overflow: auto; display: grid; gap: 6px; align-content: start; }
  li { border: 1px solid transparent; border-radius: 6px; }
  li.open { border-color: var(--accent); }
  .card { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; padding: 7px 8px; border-radius: 6px; background: none; }
  .card:hover { background: var(--wash); }
  li.open .card { background: var(--accent-wash); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .name { font-weight: 600; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; }
  .actions form { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
  .actions input { flex: 1; min-width: 8rem; }
  .actions a { margin-left: auto; color: var(--accent); font-size: 13px; }
</style>

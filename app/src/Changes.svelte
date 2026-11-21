<script lang="ts">
  import { fieldChanges, lineDiff } from './diff.js'
  import { makeEntry, titleOf } from './logic.js'
  import type { ChangeItem, ChangeState } from './api.js'
  import type { Action } from './review.svelte.js'
  import type { Workspace } from './workspace.svelte.js'

  let { ws }: { ws: Workspace } = $props()
  const review = $derived(ws.review)

  const FILTERS = [
    ['waiting', 'Warten'],
    ['drafts', 'Entwürfe'],
    ['done', 'Erledigt'],
  ] as const
  const STATE: Record<ChangeState, string> = { draft: 'Entwurf', submitted: 'Eingereicht', merged: 'Übernommen', closed: 'Geschlossen' }
  const KIND = { added: 'Neu', modified: 'Geändert', removed: 'Gelöscht' } as const

  let asking = $state<Action>()
  let item = $state<string>()
  let yaml = $state(false)
  let draft = $state('')

  const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  const nameOf = (i: ChangeItem) => titleOf(makeEntry(i.path, i.after ?? i.before ?? ''))
  const grouped = $derived(
    (['added', 'modified', 'removed'] as const).map((kind) => ({ kind, items: (review.detail?.items ?? []).filter((i) => i.change === kind) })).filter((g) => g.items.length > 0),
  )
  const shown = $derived(review.detail?.items.find((i) => i.path === item) ?? review.detail?.items[0])

  // Whatever was asked for belongs to the change that was open.
  $effect(() => {
    void review.selected
    asking = undefined
    item = undefined
    draft = ''
  })

  async function confirm(action: Action) {
    await review.act(action)
    asking = undefined
  }

  async function send(event: Event) {
    event.preventDefault()
    if (await review.comment(draft)) draft = ''
  }
</script>

<div class="panes">
  <aside>
    <nav>
      {#each FILTERS as [key, label]}
        <button class:on={review.filter === key} onclick={() => (review.filter = key)}>{label} <span class="muted">{review.count[key]}</span></button>
      {/each}
    </nav>
    <ul>
      {#each review.shown as change (change.number)}
        <li>
          <button class:active={review.selected === change.number} onclick={() => void review.select(change.number)}>
            <span class="name">{change.name}</span>
            <span class="meta muted">{change.author} · {when(change.updated)}</span>
            <span class="chip {change.state}">{STATE[change.state]}</span>
          </button>
        </li>
      {:else}
        <li class="muted none">Nichts in dieser Liste.</li>
      {/each}
    </ul>
  </aside>

  <section class="detail">
    {#if !review.change}
      <p class="muted empty">Links eine Änderung wählen.</p>
    {:else}
      {@const change = review.change}
      <header>
        <div>
          <h1>{change.name}</h1>
          <div class="muted">{change.author} · {when(change.updated)} · <span class="chip {change.state}">{STATE[change.state]}</span> · <a href={change.url} target="_blank" rel="noreferrer">Auf GitHub ansehen</a></div>
        </div>
        <div class="actions">
          {#if asking}
            <span>{asking === 'merge' ? 'Änderung übernehmen?' : asking === 'close' ? 'Änderung schließen, ohne sie zu übernehmen?' : 'Änderung zur Übernahme einreichen?'}</span>
            <button class="primary" onclick={() => void confirm(asking!)} disabled={!!review.acting}>{review.acting ? 'Einen Moment ...' : 'Ja'}</button>
            <button onclick={() => (asking = undefined)} disabled={!!review.acting}>Nein</button>
          {:else if change.state === 'draft' || change.state === 'submitted'}
            <button onclick={() => void ws.work(change)}>Bearbeiten</button>
            {#if change.state === 'draft'}<button class="primary" onclick={() => (asking = 'submit')}>Einreichen</button>{/if}
            {#if change.state === 'submitted'}
              <span title={review.blocked ?? ''}><button class="primary" disabled={!!review.blocked} onclick={() => (asking = 'merge')}>Übernehmen</button></span>
            {/if}
            <button class="danger" onclick={() => (asking = 'close')}>Schließen</button>
          {/if}
        </div>
      </header>

      {#if review.error}<p class="error-box">{review.error}</p>{/if}

      {#if review.detailState === 'loading' && !review.detail}
        <p class="muted">Lädt ...</p>
      {:else if review.detail}
        <p class="checks {review.detail.checks}">
          {#if review.detail.checks === 'success'}✓ Die automatische Prüfung ist bestanden.
          {:else if review.detail.checks === 'failure'}✗ Die automatische Prüfung ist fehlgeschlagen.
          {:else if review.detail.checks === 'pending'}… Die automatische Prüfung läuft noch.
          {:else}Keine automatische Prüfung.{/if}
          {#if review.blocked && review.detail.checks !== 'failure'} {review.blocked}{/if}
        </p>

        <div class="cols">
          <div class="items">
            {#each grouped as group}
              <h2>{KIND[group.kind]} <span class="muted">{group.items.length}</span></h2>
              <ul>
                {#each group.items as i (i.path)}
                  <li>
                    <button class:active={shown?.path === i.path} onclick={() => (item = i.path)}>
                      <span>{nameOf(i)}</span>
                      {#if review.problems.has(i.path)}<span class="problem" title="Nicht gültig">!</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">Diese Änderung enthält noch nichts.</p>
            {/each}
            {#if review.detail.truncated}<p class="muted">Es sind mehr Einträge betroffen, als hier gezeigt werden.</p>{/if}
          </div>

          <div class="diff">
            {#if shown}
              <div class="head">
                <strong>{nameOf(shown)}</strong> <span class="muted mono">{shown.path}</span>
                <span class="spacer"></span>
                <button class:on={!yaml} onclick={() => (yaml = false)}>Felder</button>
                <button class:on={yaml} onclick={() => (yaml = true)}>YAML</button>
              </div>
              {#each review.problems.get(shown.path) ?? [] as issue}<p class="error-box"><span class="mono">{issue.path}</span> {issue.message}</p>{/each}
              {#if yaml}
                <pre class="mono">{#each lineDiff(shown.before, shown.after) as line}<span class="line {line.kind}">{line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}{line.text}
</span>{/each}</pre>
              {:else}
                {#each fieldChanges(shown.before, shown.after) as field (field.field)}
                  <div class="field">
                    <div class="label">{field.label}</div>
                    {#if field.before !== undefined}<div class="was">{field.before}</div>{/if}
                    {#if field.after !== undefined}<div class="is">{field.after}</div>{/if}
                  </div>
                {:else}
                  <p class="muted">Keine Unterschiede.</p>
                {/each}
              {/if}
            {/if}
          </div>
        </div>

        <h2>Kommentare <span class="muted">{review.comments.length}</span></h2>
        <ul class="comments">
          {#each review.comments as comment (comment.id)}
            <li><div class="muted"><strong>{comment.author}</strong> · {when(comment.created)}</div><div class="body">{comment.body}</div></li>
          {/each}
        </ul>
        <form onsubmit={send}>
          <textarea rows="3" bind:value={draft} placeholder="Kommentar schreiben ..."></textarea>
          <button type="submit" disabled={!draft.trim()}>Kommentieren</button>
        </form>
      {/if}
    {/if}
  </section>
</div>

<style>
  .panes { flex: 1; display: grid; grid-template-columns: 22rem 1fr; gap: 12px; padding: 12px 16px; min-height: 0; }
  aside, .detail { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; min-height: 0; }
  aside { display: flex; flex-direction: column; }
  aside nav { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid var(--line); }
  aside nav button, .head button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; }
  aside nav button.on, .head button.on { background: var(--accent-wash); color: var(--accent); }
  aside ul { list-style: none; margin: 0; padding: 6px; overflow: auto; }
  aside li button { display: grid; width: 100%; text-align: left; border: 0; padding: 7px 8px; border-radius: 6px; background: none; gap: 2px; }
  aside li button:hover { background: var(--wash); }
  aside li button.active { background: var(--accent-wash); }
  .name { font-weight: 600; }
  .meta { font-size: 13px; }
  .none { padding: 8px; }
  .detail { overflow: auto; padding: 16px 20px 32px; }
  .empty { padding: 8px 0; }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  h1 { margin: 0 0 2px; font-size: 1.35rem; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 18px 0 4px; }
  .actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .chip { display: inline-block; justify-self: start; font-size: 12px; padding: 0 8px; border-radius: 999px; background: var(--wash); color: var(--muted); }
  .chip.submitted { background: var(--accent-wash); color: var(--accent); }
  .chip.merged { background: #e9f5ec; color: var(--ok); }
  .chip.closed { background: var(--bad-wash); color: var(--bad); }
  .checks { margin: 12px 0 0; font-size: 14px; }
  .checks.success { color: var(--ok); }
  .checks.failure { color: var(--bad); }
  .checks.pending, .checks.none { color: var(--muted); }
  .cols { display: grid; grid-template-columns: 16rem 1fr; gap: 16px; margin-top: 8px; }
  .items ul { list-style: none; margin: 0; padding: 0; }
  .items li button { display: flex; justify-content: space-between; width: 100%; text-align: left; border: 0; padding: 5px 8px; border-radius: 6px; background: none; }
  .items li button:hover { background: var(--wash); }
  .items li button.active { background: var(--accent-wash); color: var(--accent); }
  .problem { color: var(--bad); font-weight: 700; }
  .diff { min-width: 0; }
  .head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
  .spacer { flex: 1; }
  .field { margin-bottom: 12px; }
  .label { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .was, .is { white-space: pre-wrap; padding: 4px 8px; border-radius: 4px; }
  .was { background: var(--bad-wash); text-decoration: line-through; color: var(--bad); }
  .is { background: #e9f5ec; margin-top: 2px; }
  pre { margin: 0; overflow: auto; background: var(--wash); border-radius: 6px; padding: 8px 0; }
  .line { display: block; padding: 0 10px; white-space: pre; }
  .line.add { background: #e9f5ec; }
  .line.del { background: var(--bad-wash); }
  .comments { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 10px; }
  .comments .body { white-space: pre-wrap; }
  form { display: grid; gap: 8px; justify-items: start; }
  a { color: var(--accent); }
</style>

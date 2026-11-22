<script lang="ts">
  import { MODEL, TEXT_ROLES, type EntryType } from '@contents-editor/core'
  import { idOf, titleOf, typeOf, type Entry } from './logic.js'
  import Tree from './Tree.svelte'
  import type { Workspace } from './workspace.svelte.js'

  let { ws }: { ws: Workspace } = $props()

  const types = Object.keys(MODEL.types) as EntryType[]
  let filter = $state('')

  // The entries as the browser sees them: parsed once, with what points at each of them.
  const index = $derived.by(() => {
    const byId = new Map<string, Entry>()
    const back = new Map<string, Entry[]>()
    for (const e of ws.entries) byId.set(idOf(e), e)
    for (const e of ws.entries) {
      const type = typeOf(e)
      if (!type || !e.data) continue
      for (const [name, field] of Object.entries(MODEL.types[type].fields)) {
        const value = e.data[name]
        if (field.kind !== 'ref') continue
        // A list of ids, or one (a single reference).
        for (const id of Array.isArray(value) ? value : [value]) if (typeof id === 'string') back.set(id, [...(back.get(id) ?? []), e])
      }
    }
    return { byId, back }
  })

  /** A second line for the list: what tells entries of one type apart. */
  function hint(e: Entry): string {
    const d = e.data ?? {}
    const type = typeOf(e)
    if (type === 'content') return typeof d.published === 'string' ? d.published : ''
    if (type === 'place') return typeof d.address === 'string' ? d.address : ''
    if (type === 'media') return [MODEL.types.media.subtypes[d.subtype as keyof typeof MODEL.types.media.subtypes], d.date].filter(Boolean).join(' · ')
    if (type === 'event') return d.recurring ? 'wiederkehrend' : ''
    return ''
  }

  const selected = $derived(ws.selected)
  const type = $derived(selected ? typeOf(selected) : undefined)
  const model = $derived(type ? MODEL.types[type] : undefined)
  const links = $derived((selected && index.back.get(idOf(selected))) || [])
  const incoming = $derived(types.map((t) => ({ type: t, entries: links.filter((e) => typeOf(e) === t) })).filter((g) => g.entries.length > 0))

  const roleLabel = (role: string) => MODEL.textRoles[role as keyof typeof MODEL.textRoles]?.label ?? role
  const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`)
  const open = (id: string) => {
    const target = index.byId.get(id)
    if (target) ws.select(target.path)
  }
  let role = $state<string>()
  const roles = $derived(selected?.data?.text && typeof selected.data.text === 'object' ? Object.keys(selected.data.text as object) : [])
  const activeRole = $derived(role && roles.includes(role) ? role : roles[0])
</script>

<div class="panes">
  <aside>
    <div class="tools">
      <input type="text" placeholder="{ws.entries.length} Einträge durchsuchen ..." bind:value={filter} />
    </div>
    <Tree entries={ws.entries} folders={ws.folders} selected={ws.selectedPath} {filter} {hint} onselect={(path) => ws.select(path)} />
  </aside>

  <section class="detail">
    {#if selected && model}
      <article>
        <header>
          <div>
            <div class="muted small">{model.label}{#if selected.data?.subtype} · {model.subtypes[selected.data.subtype as keyof typeof model.subtypes] ?? selected.data.subtype}{/if}</div>
            <h1>{titleOf(selected)}</h1>
            <div class="muted mono small">{selected.path}</div>
          </div>
          <button class="primary" onclick={() => { ws.editing = true }}>Bearbeiten</button>
        </header>

        <dl>
          {#each Object.entries(model.fields) as [name, field]}
            {@const value = selected.data?.[name]}
            {#if value !== undefined && field.kind !== 'text' && name !== 'title' && name !== 'name'}
              <dt>{field.label}</dt>
              <dd>
                {#if field.kind === 'ref' && (Array.isArray(value) || typeof value === 'string')}
                  <span class="refs">
                    {#each [value].flat() as id}
                      {@const target = index.byId.get(id)}
                      {#if target}
                        <button class="ref" onclick={() => open(id)}>{titleOf(target)}</button>
                      {:else}
                        <span class="ref broken" title="Diesen Eintrag gibt es nicht">{id}</span>
                      {/if}
                    {/each}
                  </span>
                {:else if field.kind === 'links' && Array.isArray(value)}
                  {#each value as l}<div><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a> <span class="muted small">{l.url}</span></div>{/each}
                {:else if field.kind === 'location'}
                  <span class="mono">{(value as { lat: number; lon: number }).lat}, {(value as { lat: number; lon: number }).lon}</span>
                {:else if field.kind === 'choice'}
                  {(field as { options?: Record<string, string> }).options?.[String(value)] ?? String(value)}
                {:else if field.kind === 'boolean'}
                  {value ? 'Ja' : 'Nein'}
                {:else if field.kind === 'files' && Array.isArray(value)}
                  {#each value as f}
                    <div class="file">
                      <span class="mono small">{f.original_name ?? f.path.split('/').pop()}</span>
                      <span class="muted small">{f.mime} · {fmtBytes(f.bytes)}{#if f.width} · {f.width}×{f.height}{/if}{#if f.variants?.length} · {f.variants.length} Variante{f.variants.length > 1 ? 'n' : ''}{/if}</span>
                    </div>
                  {/each}
                {:else}
                  {String(value)}
                {/if}
              </dd>
            {/if}
          {/each}
        </dl>

        {#if roles.length > 0}
          <div class="texts">
            <div class="tabs">
              {#each TEXT_ROLES as r}
                {#if roles.includes(r)}<button class:on={activeRole === r} onclick={() => (role = r)}>{roleLabel(r)}</button>{/if}
              {/each}
              {#each TEXT_ROLES.filter((r) => !roles.includes(r)) as r}<span class="missing" title="Fehlt; wird aus einer anderen Rolle abgeleitet, wenn möglich">{roleLabel(r)}</span>{/each}
            </div>
            <div class="body">{(selected.data!.text as Record<string, string>)[activeRole!]}</div>
          </div>
        {/if}

        {#if incoming.length > 0}
          <div class="incoming">
            <h2>Verweist hierher</h2>
            {#each incoming as g}
              <h3>{MODEL.types[g.type].label}</h3>
              <div class="refs">
                {#each g.entries as e (e.path)}
                  <button class="ref" onclick={() => ws.select(e.path)}>{titleOf(e)}</button>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </article>
    {:else}
      <p class="muted empty">Links einen Eintrag wählen.</p>
    {/if}
  </section>
</div>

<style>
  .panes { flex: 1; display: grid; grid-template-columns: 26rem 1fr; gap: 12px; padding: 12px 16px; min-height: 0; }
  aside { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; }
  .tools { padding: 10px; }
  .detail { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; overflow: auto; }
  article { padding: 18px 22px 28px; max-width: 54rem; }
  article > header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  h1 { margin: 2px 0 4px; font-size: 1.5rem; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 24px 0 6px; }
  h3 { font-size: 13px; margin: 10px 0 4px; }
  .small { font-size: 12px; }
  dl { display: grid; grid-template-columns: 9rem 1fr; gap: 8px 14px; margin: 0; }
  dt { color: var(--muted); font-size: 13px; padding-top: 2px; }
  dd { margin: 0; }
  .refs { display: flex; flex-wrap: wrap; gap: 6px; }
  .ref { display: inline-flex; gap: 6px; align-items: center; border-radius: 999px; padding: 2px 10px; font-size: 13px; background: var(--wash); }
  .ref.broken { color: var(--bad); background: var(--bad-wash); padding: 2px 10px; border-radius: 999px; }
  .file { display: flex; flex-direction: column; margin-bottom: 4px; }
  .texts { margin-top: 22px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--line); }
  .tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 5px 10px; }
  .tabs button.on { border-bottom-color: var(--accent); color: var(--accent); }
  .missing { font-size: 13px; padding: 5px 10px; color: #b9bfca; text-decoration: line-through; }
  .body { white-space: pre-wrap; padding: 12px 2px; max-width: 42rem; }
  .empty { padding: 24px; }
</style>

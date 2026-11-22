<script lang="ts">
  import { MODEL, type TextRole } from '@contents-editor/core'
  import { fieldOfIssue, isDirty, setRole, setValue, titleOf, typeOf, type FieldKind } from './logic.js'
  import type { Workspace } from './workspace.svelte.js'
  import RefField from './RefField.svelte'
  import LinksField from './LinksField.svelte'
  import LocationField from './LocationField.svelte'
  import TextRoles from './TextRoles.svelte'

  let { ws }: { ws: Workspace } = $props()

  // The entry is fixed for the life of this form (Main keys it by path); its text changes.
  const entry = $derived(ws.selected!)
  const type = $derived(typeOf(entry))
  const model = $derived(type ? MODEL.types[type] : undefined)
  const dirty = $derived(isDirty(entry))
  let view = $state<'form' | 'yaml'>('form')
  const shown = $derived(model && entry.data ? view : 'yaml')

  // The editor's own findings, and what the server refused with (the same ones, when it did).
  const all = $derived([...ws.issues, ...ws.refused.filter((r) => !ws.issues.some((i) => i.path === r.path && i.message === r.message))])
  const forField = (name: string) => all.filter((i) => fieldOfIssue(i) === name)
  const general = $derived(all.filter((i) => !model || !fieldOfIssue(i) || !(fieldOfIssue(i)! in model.fields)))
  const editable = $derived(ws.editable)
  const canSave = $derived(editable && dirty && !ws.saving && ws.issues.length === 0)

  const data = (name: string): any => entry.data?.[name]
  const set = (name: string, kind: FieldKind, value: unknown) => ws.edit(setValue(entry, name, kind, value))

  async function remove() {
    const sure = entry.sha === undefined || confirm(`„${titleOf(entry)}“ wirklich löschen?`)
    if (sure) await ws.remove()
  }

  function key(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault()
      if (canSave) void ws.save()
    }
  }
</script>

<svelte:window onkeydown={key} />

<article>
  <header>
    <div class="title">
      <h1>{titleOf(entry)}</h1>
      <div class="muted"><span>{model?.label ?? 'Unbekannte Art'}</span> · <span class="mono">{entry.path}</span></div>
    </div>
    <div class="actions">
      <button onclick={() => ws.revert()} disabled={!dirty || !editable}>{entry.sha === undefined ? 'Verwerfen' : 'Zurücksetzen'}</button>
      <button class="danger" onclick={remove} disabled={!editable}>Löschen</button>
      <button class="primary" onclick={() => void ws.save()} disabled={!canSave} title={ws.issues.length ? 'Erst die Probleme beheben.' : 'Speichern (Strg/Cmd+S)'}>
        {ws.saving ? 'Speichert ...' : 'Speichern'}
      </button>
    </div>
  </header>

  <nav>
    <button class:on={shown === 'form'} onclick={() => (view = 'form')} disabled={!model || !entry.data}>Formular</button>
    <button class:on={shown === 'yaml'} onclick={() => (view = 'yaml')}>YAML</button>
    {#if entry.sha === undefined}<span class="muted new">neu, noch nicht gespeichert</span>{:else if dirty}<span class="muted new">geändert</span>
    {:else if ws.savedAt?.path === entry.path}<span class="saved">✓ gespeichert um {ws.savedAt.at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} auf {ws.branch}</span>{/if}
  </nav>

  {#if general.length}
    <ul class="error-box issues">
      {#each general as issue}<li><span class="mono">{issue.path}</span> {issue.message}</li>{/each}
    </ul>
  {/if}

  {#if shown === 'yaml'}
    <textarea class="mono yaml" spellcheck="false" readonly={!editable} value={entry.text} oninput={(event) => ws.edit(event.currentTarget.value)}></textarea>
  {:else if model}
    <fieldset class="fields" disabled={!editable}>
      {#each Object.entries(model.fields) as [name, field] (name)}
        {@const kind = field.kind as FieldKind}
        <div class="field" class:bad={forField(name).length > 0}>
          {#if kind !== 'text'}
            <label for={`f-${name}`}>{field.label}{#if field.required}<span class="req" title="Pflichtfeld"> *</span>{/if}</label>
          {/if}
          {#if kind === 'string'}
            <input id={`f-${name}`} type="text" value={data(name) ?? ''} oninput={(event) => set(name, kind, event.currentTarget.value)} />
          {:else if kind === 'choice'}
            <select id={`f-${name}`} value={data(name) ?? ''} onchange={(event) => set(name, 'string', event.currentTarget.value)}>
              <option value="">–</option>
              {#each Object.entries((field as { options?: Record<string, string> }).options ?? {}) as [value, label]}<option {value}>{label}</option>{/each}
            </select>
          {:else if kind === 'date'}
            <input id={`f-${name}`} type="date" value={data(name) ?? ''} oninput={(event) => set(name, kind, event.currentTarget.value)} />
          {:else if kind === 'boolean'}
            <input id={`f-${name}`} type="checkbox" checked={data(name) === true} onchange={(event) => set(name, kind, event.currentTarget.checked)} />
          {:else if kind === 'ref'}
            {#if (field as { single?: boolean }).single}
              <!-- One id, a string: the same chooser, with room for one. -->
              <RefField value={data(name) ? [data(name)] : []} targets={(field as { ref: readonly string[] }).ref} max={1} entries={ws.entries} onchange={(ids) => set(name, 'string', ids[0] ?? '')} />
            {:else}
              <RefField value={data(name) ?? []} targets={(field as { ref: readonly string[] }).ref} max={(field as { max?: number }).max} entries={ws.entries} onchange={(ids) => set(name, kind, ids)} />
            {/if}
          {:else if kind === 'links'}
            <LinksField value={data(name) ?? []} onchange={(links) => set(name, kind, links)} />
          {:else if kind === 'location'}
            <LocationField value={data(name)} onchange={(value) => set(name, kind, value)} />
          {:else if kind === 'text'}
            <TextRoles value={data(name) ?? {}} onchange={(role: TextRole, text: string) => ws.edit(setRole(entry, role, text))} />
          {:else if kind === 'files'}
            <ul class="files">
              {#each data(name) ?? [] as file}
                <li><span class="mono">{file.role}</span> · {file.mime} · {Math.round((file.bytes ?? 0) / 1024)} kB <span class="muted mono">{file.original_name ?? file.path}</span></li>
              {/each}
              <li class="muted">Dateien lassen sich später hier hochladen; bis dahin nur im YAML.</li>
            </ul>
          {:else}
            <span class="muted">Dieses Feld lässt sich nur im YAML ändern.</span>
          {/if}
          {#if (field as { description?: string }).description}<div class="muted hint">{(field as { description?: string }).description}</div>{/if}
          {#each forField(name) as issue}<div class="issue">{issue.message}</div>{/each}
        </div>
      {/each}
    </fieldset>
  {/if}
</article>

<style>
  article { padding: 16px 20px 40px; max-width: 54rem; }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  h1 { margin: 0 0 2px; font-size: 1.35rem; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  nav { display: flex; gap: 6px; align-items: center; margin: 14px 0; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
  nav button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; }
  nav button.on { background: var(--accent-wash); color: var(--accent); }
  .new { margin-left: 8px; font-size: 13px; }
  .saved { margin-left: 8px; font-size: 13px; color: var(--ok); }
  .issues { margin: 0 0 14px; padding: 8px 12px 8px 28px; }
  .fields { display: flex; flex-direction: column; gap: 16px; border: 0; padding: 0; margin: 0; min-width: 0; }
  .field > label { display: block; font-weight: 600; margin-bottom: 4px; }
  .req { color: var(--bad); }
  .hint { font-size: 12px; margin-top: 3px; }
  .issue { color: var(--bad); font-size: 13px; margin-top: 3px; }
  .field.bad input[type='text'], .field.bad input[type='date'], .field.bad select { border-color: var(--bad); }
  .files { margin: 0; padding-left: 18px; }
  .yaml { min-height: 28rem; }
  input[type='checkbox'] { width: auto; }
  select { width: auto; min-width: 12rem; }
</style>

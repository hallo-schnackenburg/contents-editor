<script lang="ts">
  import { untrack } from 'svelte'

  type Date_ = { start: string; end?: string; note?: string; cancelled?: boolean }
  type Row = { startDate: string; startTime: string; endDate: string; endTime: string; note: string; cancelled: boolean }
  let { value, onchange }: { value: Date_[]; onchange: (dates: Date_[]) => void } = $props()

  const split = (when?: string): [string, string] => [when?.slice(0, 10) ?? '', when?.slice(11, 16) ?? '']
  const join = (date: string, time: string) => (date ? (time ? `${date}T${time}` : date) : '')
  const rowOf = (d: Date_): Row => {
    const [startDate, startTime] = split(d.start)
    const [endDate, endTime] = split(d.end)
    return { startDate, startTime, endDate, endTime, note: d.note ?? '', cancelled: d.cancelled === true }
  }
  const empty = (): Row => ({ startDate: '', startTime: '', endDate: '', endTime: '', note: '', cancelled: false })
  const dateOf = (r: Row): Date_ => {
    const end = join(r.endDate, r.endTime)
    return { start: join(r.startDate, r.startTime), ...(end ? { end } : {}), ...(r.note.trim() ? { note: r.note.trim() } : {}), ...(r.cancelled ? { cancelled: true } : {}) }
  }

  // The rows are kept here: a new row without a date yet must stay while it is being filled in.
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(value.length > 0 ? value.map(rowOf) : [empty()])
  const emit = () => onchange(rows.map(dateOf))

  // Changed from outside (the assistant filled it in): what the entry has is shown. Rows without a date are not the entry's, they stay.
  const norm = (dates: Date_[]) => JSON.stringify(dates.map((d) => [d.start, d.end ?? '', d.note ?? '', d.cancelled === true]))
  $effect(() => {
    const dates = value
    untrack(() => {
      const complete = rows.map(dateOf).filter((d) => d.start)
      if (norm(dates) !== norm(complete)) rows = dates.length > 0 ? dates.map(rowOf) : [empty()]
    })
  })
</script>

<div class="rows">
  {#each rows as row, i}
    <div class="row" class:cancelled={row.cancelled}>
      <input type="date" aria-label="Beginn" bind:value={row.startDate} oninput={emit} />
      <input type="time" aria-label="Uhrzeit" bind:value={row.startTime} oninput={emit} />
      <input type="date" aria-label="Ende" bind:value={row.endDate} oninput={emit} />
      <input type="time" aria-label="Ende, Uhrzeit" bind:value={row.endTime} oninput={emit} />
      <input type="text" placeholder="Notiz" bind:value={row.note} oninput={emit} />
      <label class="check"><input type="checkbox" bind:checked={row.cancelled} onchange={emit} /> ausgefallen</label>
      <button type="button" title="Entfernen" onclick={() => { rows.splice(i, 1); emit() }}>×</button>
    </div>
  {/each}
  <button type="button" onclick={() => rows.push(empty())}>+ Termin</button>
</div>

<style>
  .rows { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; width: 100%; }
  .row input[type='text'] { flex: 1 1 10rem; min-width: 8rem; }
  .row.cancelled { opacity: 0.6; }
  .check { display: flex; gap: 4px; align-items: center; font-weight: normal; margin: 0; white-space: nowrap; }
</style>

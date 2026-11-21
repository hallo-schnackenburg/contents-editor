import { describe, expect, it } from 'vitest'
import { validateRepo, type RepoFile } from '../src/repo.js'
import { examples } from './fixtures.js'

const files = (): RepoFile[] => examples().map((e) => ({ path: e.path, text: e.text }))

describe('validateRepo', () => {
  it('has nothing to say about the examples', () => {
    expect(validateRepo(files())).toEqual([])
  })

  it('names the entry and the problem, entries in order', () => {
    const all = files().map((f) => (f.path.endsWith('erika-mustermann.yaml') ? { ...f, text: 'id: erika-mustermann\ntype: person\n' } : f))
    expect(validateRepo(all)).toEqual([{ path: 'entities/people/erika-mustermann.yaml', issues: [{ path: '/', message: 'missing field "name"' }] }])
  })

  it('finds a reference that leads nowhere, or to the wrong kind of entry', () => {
    const all = files().map((f) =>
      f.path.endsWith('osterfeuer-tradition.yaml') ? { ...f, text: f.text.replace('about: [osterfeuer, feuerwehr-schnackenburg]', 'about: [osterfeuer, gibts-nicht, osterfeuer-tradition]') } : f,
    )
    const [problem] = validateRepo(all)
    expect(problem.path).toBe('contents/traditionen/osterfeuer-tradition.yaml')
    expect(problem.issues.map((i) => i.message)).toEqual(['"gibts-nicht" does not exist', expect.stringMatching(/osterfeuer-tradition/)])
  })

  it('finds an id that is used twice, and an entry that is not where its id says', () => {
    const erika = files().find((f) => f.path.endsWith('erika-mustermann.yaml'))!
    const problems = validateRepo([...files(), { path: 'entities/people/zweite-erika.yaml', text: erika.text }])
    expect(problems.map((p) => p.path)).toEqual(['entities/people/zweite-erika.yaml'])
    expect(problems[0].issues.map((i) => i.message).join(' ')).toMatch(/id must be the file name/)
  })

  it('refuses a file in our folders that is not the path of an entry, and leaves the rest of the repository alone', () => {
    const problems = validateRepo([...files(), { path: 'entities/people/Erika.yml', text: '' }, { path: 'README.md', text: '# x' }, { path: '.github/workflows/validate.yml', text: 'on: pull_request' }])
    expect(problems).toEqual([{ path: 'entities/people/Erika.yml', issues: [{ path: '/', message: expect.stringMatching(/not the path of an entry/) }] }])
  })
})

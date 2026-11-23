import { describe, expect, it } from 'vitest'
import { authorOf, submissionBranch, isSubmissionBranch } from '../src/submissions.js'

describe('submissionBranch', () => {
  it('is made of the login and a slug of the name', () => {
    expect(submissionBranch('svenfuchs', 'Osterfeuer 2027 – Texte')).toBe('submission/svenfuchs/osterfeuer-2027-texte')
    expect(submissionBranch('anna-b', 'Fähre')).toBe('submission/anna-b/faehre')
  })

  it('stays short and refuses a name without letters', () => {
    expect(submissionBranch('a', 'x'.repeat(100)).length).toBeLessThan(80)
    expect(() => submissionBranch('a', '???')).toThrow(/keinen gültigen Namen/)
    expect(() => submissionBranch('---', 'x')).toThrow(/Login/)
  })

  it('is recognised, and tells whose it is', () => {
    const branch = submissionBranch('svenfuchs', 'Fest')
    expect(isSubmissionBranch(branch)).toBe(true)
    expect(authorOf(branch)).toBe('svenfuchs')
    for (const bad of ['main', 'edit/anna', 'submission/anna', 'submission/anna/Fest', 'submission/anna/a/b', 'submission//x', 42, undefined]) expect(isSubmissionBranch(bad)).toBe(false)
  })
})

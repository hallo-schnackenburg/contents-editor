import { describe, expect, it } from 'vitest'
import { authorOf, changeBranch, isChangeBranch } from '../src/changes.js'

describe('changeBranch', () => {
  it('is made of the login and a slug of the name', () => {
    expect(changeBranch('svenfuchs', 'Osterfeuer 2027 – Texte')).toBe('change/svenfuchs/osterfeuer-2027-texte')
    expect(changeBranch('anna-b', 'Fähre')).toBe('change/anna-b/faehre')
  })

  it('stays short and refuses a name without letters', () => {
    expect(changeBranch('a', 'x'.repeat(100)).length).toBeLessThan(70)
    expect(() => changeBranch('a', '???')).toThrow(/keinen gültigen Namen/)
    expect(() => changeBranch('---', 'x')).toThrow(/Login/)
  })

  it('is recognised, and tells whose it is', () => {
    const branch = changeBranch('svenfuchs', 'Fest')
    expect(isChangeBranch(branch)).toBe(true)
    expect(authorOf(branch)).toBe('svenfuchs')
    for (const bad of ['main', 'edit/anna', 'change/anna', 'change/anna/Fest', 'change/anna/a/b', 'change//x', 42, undefined]) expect(isChangeBranch(bad)).toBe(false)
  })
})

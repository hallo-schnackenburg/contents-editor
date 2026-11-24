import { describe, expect, it } from 'vitest'
import { ruleText } from '../src/ruletext.js'

describe('a rule in words', () => {
  it('says where an anchor day lies: before and after Easter and the first Advent', () => {
    expect(ruleText('FREQ=YEARLY;BYEASTER=-1')).toBe('Jährlich am Samstag vor Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=-2')).toBe('Jährlich am Freitag vor Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=0')).toBe('Jährlich am Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=1')).toBe('Jährlich am Montag nach Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=63')).toBe('Jährlich am Sonntag 9 Wochen nach Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=7')).toBe('Jährlich am Sonntag 1 Woche nach Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYEASTER=39')).toBe('Jährlich am Donnerstag, 39 Tage nach Ostersonntag')
    expect(ruleText('FREQ=YEARLY;BYADVENT=-1')).toBe('Jährlich am Samstag vor dem 1. Advent')
    expect(ruleText('FREQ=YEARLY;BYADVENT=-7,-1')).toBe('Jährlich am Sonntag 1 Woche vor dem 1. Advent und Samstag vor dem 1. Advent')
    expect(ruleText('FREQ=YEARLY;INTERVAL=2;BYADVENT=-1;COUNT=3')).toBe('Alle 2 Jahre am Samstag vor dem 1. Advent, 3-mal')
  })

  it('says what the calendar rules say', () => {
    expect(ruleText('FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=30')).toBe('Jährlich am 30. April')
    expect(ruleText('FREQ=MONTHLY;BYDAY=-1SA')).toBe('Monatlich am letzten Samstag')
    expect(ruleText('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=10')).toBe('Alle 2 Wochen dienstags, 10-mal')
    expect(ruleText('FREQ=YEARLY;BYMONTH=6;BYDAY=2SA;UNTIL=20271231')).toBe('Jährlich am zweiten Samstag im Juni, bis 31.12.2027')
    expect(ruleText('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('Wöchentlich montags und mittwochs')
    expect(ruleText('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBe('Monatlich am 1. und 15.')
    expect(ruleText('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('Monatlich am letzten Tag')
    expect(ruleText('FREQ=YEARLY;BYMONTH=7')).toBe('Jährlich im Juli')
    expect(ruleText('RRULE:FREQ=DAILY')).toBe('Täglich')
  })

  it('says nothing about a rule it cannot put well', () => {
    expect(ruleText('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1')).toBeUndefined()
    expect(ruleText('FREQ=YEARLY;BYWEEKNO=20')).toBeUndefined()
    expect(ruleText('FREQ=SOMETIMES')).toBeUndefined()
    expect(ruleText('BYDAY=MO')).toBeUndefined()
    expect(ruleText('')).toBeUndefined()
    expect(ruleText('FREQ=YEARLY;BYEASTER=x')).toBeUndefined()
    expect(ruleText('FREQ=WEEKLY;BYDAY=XX')).toBeUndefined()
  })
})

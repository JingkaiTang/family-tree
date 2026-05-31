import { describe, expect, it } from 'vitest'
import { relationDistanceTone } from './relationDistanceTone'

describe('relationDistanceTone', () => {
  it('keeps the default card background outside center layout', () => {
    expect(relationDistanceTone(undefined)).toBe('bg-white')
  })

  it('uses distinct background colors for near and far relation distances', () => {
    expect(relationDistanceTone(0)).toContain('bg-amber-50')
    expect(relationDistanceTone(1)).toContain('bg-emerald-50')
    expect(relationDistanceTone(2)).toContain('bg-sky-50')
    expect(relationDistanceTone(4)).toContain('bg-slate-50')
    expect(new Set([0, 1, 2, 3, 4].map(relationDistanceTone)).size).toBe(5)
  })
})

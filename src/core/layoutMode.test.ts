/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectDefaultLayoutMode,
  resolveLayoutMode,
} from './layoutMode'

describe('layoutMode', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves explicit choices without changing them for the device', () => {
    expect(resolveLayoutMode('family-grid', 'focus-flow')).toBe('family-grid')
    expect(resolveLayoutMode('focus-flow', 'family-grid')).toBe('focus-flow')
    expect(resolveLayoutMode('auto', 'focus-flow')).toBe('focus-flow')
  })

  it('defaults compact coarse-pointer devices to focus flow', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' || query === '(max-width: 1023px)',
    })))
    expect(detectDefaultLayoutMode()).toBe('focus-flow')
  })

  it('defaults desktop devices to the family grid', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    expect(detectDefaultLayoutMode()).toBe('family-grid')
  })
})

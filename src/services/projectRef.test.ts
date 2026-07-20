import { describe, expect, it } from 'vitest'
import {
  externalProjectRef,
  isProjectRef,
  projectRefLocation,
  projectRefName,
} from './projectRef'

describe('projectRef', () => {
  it('preserves an external project path for desktop projects', () => {
    const project = externalProjectRef('/tmp/测试.family')

    expect(projectRefLocation(project)).toBe('/tmp/测试.family')
    expect(projectRefName(project)).toBe('测试.family')
  })

  it('does not expose a filesystem location for managed projects', () => {
    const project = { kind: 'managed', id: 'project-id' } as const

    expect(isProjectRef(project)).toBe(true)
    expect(projectRefLocation(project)).toBeNull()
  })

  it('rejects malformed persisted references', () => {
    expect(isProjectRef({ kind: 'external', path: '' })).toBe(false)
    expect(isProjectRef({ kind: 'managed', id: 42 })).toBe(false)
    expect(isProjectRef(null)).toBe(false)
  })
})

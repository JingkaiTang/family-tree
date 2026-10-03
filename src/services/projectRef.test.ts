import { describe, expect, it } from 'vitest'
import { isProjectRef } from './projectRef'

describe('projectRef', () => {
  it.each(['browser-directory', 'drive-connection'])('accepts an opaque project reference for %s', providerId => {
    const project = { providerId, id: 'opaque-project-id', displayName: '家族' }

    expect(isProjectRef(project)).toBe(true)
  })

  it.each([
    null,
    [],
    '/old/path',
    { providerId: '', id: 'project', displayName: '家族' },
    { providerId: 'browser-directory', id: '', displayName: '家族' },
    { providerId: 'browser-directory', id: 42, displayName: '家族' },
    { providerId: 'browser-directory', id: 'project', displayName: '   ' },
  ])('rejects malformed persisted reference %j', value => {
    expect(isProjectRef(value)).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getRuntimePlatform, isMobilePlatform } from './runtime'

describe('runtime platform', () => {
  afterEach(() => {
    invoke.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses web mode outside a Tauri runtime', async () => {
    vi.stubGlobal('window', {})

    await expect(getRuntimePlatform()).resolves.toBe('web')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('asks the native layer for the actual Tauri target', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    invoke.mockResolvedValue('ios')

    await expect(getRuntimePlatform()).resolves.toBe('ios')
    expect(isMobilePlatform('ios')).toBe(true)
    expect(isMobilePlatform('macos')).toBe(false)
  })
})

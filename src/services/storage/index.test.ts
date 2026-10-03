import { afterEach, describe, expect, it, vi } from 'vitest'

describe('storage provider assembly', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('registers browser-directory and keeps its picker in the user gesture', async () => {
    const { browserDirectoryPicker } = await import('./browserDirectory')
    const picker = vi.spyOn(browserDirectoryPicker, 'pickProject').mockResolvedValue(null)
    const storage = await import('./index')

    expect(storage.hasProvider('browser-directory')).toBe(true)
    const pending = storage.pickProject('browser-directory', 'open')
    expect(picker).toHaveBeenCalledExactlyOnceWith('open')
    await expect(pending).resolves.toBeNull()
  })

  it.each(['tauri-local', 'tauri-managed', 'unconnected-provider'])('does not restore the unavailable %s provider', async providerId => {
    const storage = await import('./index')
    const project = { providerId, id: 'previous-project', displayName: '旧项目' }

    expect(storage.hasProvider(providerId)).toBe(false)
    await expect(storage.loadProject(project)).rejects.toThrow('存储提供商尚未连接')
    expect(storage.supportsMediaGc(project)).toBe(false)
  })
})

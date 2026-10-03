/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'

const { saveProject, showToast } = vi.hoisted(() => ({
  saveProject: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('./projectService', () => ({ saveProject }))
vi.mock('@/stores/ui', () => ({ useUiStore: () => ({ showToast }) }))

let removeListeners: () => void

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  const addWindowListener = vi.spyOn(window, 'addEventListener')
  const addDocumentListener = vi.spyOn(document, 'addEventListener')
  removeListeners = () => {
    for (const [type, listener, options] of addWindowListener.mock.calls) {
      window.removeEventListener(type, listener, options)
    }
    for (const [type, listener, options] of addDocumentListener.mock.calls) {
      document.removeEventListener(type, listener, options)
    }
  }
})

afterEach(() => {
  removeListeners()
  vi.restoreAllMocks()
})

describe('browser unload autosave', () => {
  it('reports a failed unload save, preserves unsaved edits, and allows a later successful retry', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { useFamilyStore } = await import('@/stores/family')
    const { startAutosave, flushNow } = await import('./autosave')
    setActivePinia(createPinia())
    const family = useFamilyStore()
    const project = { providerId: 'browser-directory', id: 'handle-id', displayName: '测试家族' }
    family.setProject(project, createEmptyMeta('测试家族'), createEmptyFamily())
    const failure = new Error('directory permission revoked')
    saveProject.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {})
    startAutosave()
    family.upsertMember(mk('a', { firstName: '未保存的编辑' }))

    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)

    expect(unload.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'error', '保存失败：directory permission revoked',
    ))
    expect(reportError).toHaveBeenCalledExactlyOnceWith('[autosave] save failed:', failure)
    expect(family.isDirty).toBe(true)
    expect(family.data.members.a.firstName).toBe('未保存的编辑')

    await flushNow()
    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(saveProject).toHaveBeenLastCalledWith(project, family.data)
    expect(family.isDirty).toBe(false)
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
    expect(saveProject).toHaveBeenCalledTimes(2)
    family.$dispose()
  })
})

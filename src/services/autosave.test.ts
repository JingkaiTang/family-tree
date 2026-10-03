/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyFamily, createEmptyMeta, type FamilyData } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import { createAutosaveController, installPageLifecycleFlush } from './autosave'
import type { ProjectRef } from '@/services/storage/types'

describe('autosave coordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('automatically saves the first edit after opening a project', async () => {
    vi.useFakeTimers()
    const family = openedFamily()
    const save = vi.fn(async (_project: ProjectRef, _data: FamilyData) => {})
    const controller = createAutosaveController(family, { debounceMs: 800, save })
    controller.start()

    family.upsertMember(mk('first'))
    await vi.advanceTimersByTimeAsync(800)

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][1].members.first.id).toBe('first')
    expect(family.isDirty).toBe(false)
    controller.stop()
  })

  it('debounces every revision instead of only the first dirty transition', async () => {
    vi.useFakeTimers()
    const family = openedFamily()
    const save = vi.fn(async (_project: ProjectRef, _data: FamilyData) => {})
    const controller = createAutosaveController(family, { debounceMs: 800, save })
    controller.start()

    family.upsertMember(mk('a', { firstName: '一' }))
    await vi.advanceTimersByTimeAsync(600)
    family.updateMember('a', { firstName: '二' })
    await vi.advanceTimersByTimeAsync(799)

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][1].members.a.firstName).toBe('二')
    expect(family.isDirty).toBe(false)
    controller.stop()
  })

  it('serializes saves and persists a newer revision before marking clean', async () => {
    const family = openedFamily()
    const pending: Array<{
      data: FamilyData
      resolve: () => void
    }> = []
    const save = vi.fn((_project: ProjectRef, data: FamilyData) => new Promise<void>(resolve => {
      pending.push({ data, resolve })
    }))
    const controller = createAutosaveController(family, { save })

    family.upsertMember(mk('a', { firstName: '旧快照' }))
    const firstFlush = controller.flushNow()
    expect(save).toHaveBeenCalledOnce()

    family.updateMember('a', { firstName: '新快照' })
    const secondFlush = controller.flushNow()
    expect(save).toHaveBeenCalledOnce()

    pending[0].resolve()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(pending[0].data.members.a.firstName).toBe('旧快照')
    expect(pending[1].data.members.a.firstName).toBe('新快照')
    expect(family.isDirty).toBe(true)

    pending[1].resolve()
    await Promise.all([firstFlush, secondFlush])

    expect(family.isDirty).toBe(false)
  })

  it('keeps the project dirty when saving fails', async () => {
    const family = openedFamily()
    const save = vi.fn(async () => {
      throw new Error('disk full')
    })
    const controller = createAutosaveController(family, { save })
    family.upsertMember(mk('a'))

    await expect(controller.flushNow()).rejects.toThrow('disk full')

    expect(family.isDirty).toBe(true)
  })

  it('flushes dirty data when the page is hidden or moved to the background', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    let dirty = true
    const onError = vi.fn()
    const cleanup = installPageLifecycleFlush(flush, () => dirty, onError)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2))

    dirty = false
    window.dispatchEvent(new Event('pagehide'))
    expect(flush).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    cleanup()
  })

  it('reports a lifecycle flush failure without losing the dirty state', async () => {
    const error = new Error('background write failed')
    const onError = vi.fn()
    const cleanup = installPageLifecycleFlush(
      vi.fn().mockRejectedValue(error),
      () => true,
      onError,
    )

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    cleanup()
  })

  it.each([
    { providerId: 'browser-directory', id: 'other-handle-id', displayName: '另一个本地项目' },
    { providerId: 'test-cloud', id: 'test-handle-id', displayName: '不同提供商的同名 ID' },
  ])('isolates queued saves when switching to $providerId / $id', async nextProject => {
    const family = openedFamily()
    const firstProject = { ...family.projectRef! }
    const pending: Array<{
      project: ProjectRef
      data: FamilyData
      resolve: () => void
    }> = []
    const save = vi.fn((project: ProjectRef, data: FamilyData) => new Promise<void>(resolve => {
      pending.push({ project, data, resolve })
    }))
    const controller = createAutosaveController(family, { save })

    family.upsertMember(mk('old', { firstName: '旧项目' }))
    const firstFlush = controller.flushNow()
    family.setProject(nextProject, createEmptyMeta('新项目'), createEmptyFamily())
    family.upsertMember(mk('new', { firstName: '新项目' }))
    const secondFlush = controller.flushNow()

    expect(save).toHaveBeenCalledOnce()
    expect(pending[0].project).toEqual(firstProject)
    pending[0].resolve()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(family.isDirty).toBe(true)
    expect(pending[1].project).toEqual(nextProject)
    expect(Object.keys(pending[0].data.members)).toEqual(['old'])
    expect(Object.keys(pending[1].data.members)).toEqual(['new'])

    pending[1].resolve()
    await Promise.all([firstFlush, secondFlush])
    expect(family.isDirty).toBe(false)
    expect(family.projectRef).toEqual(nextProject)
  })
})

function openedFamily() {
  const family = useFamilyStore()
  family.setProject(
    { providerId: 'browser-directory', id: 'test-handle-id', displayName: '测试' },
    createEmptyMeta('测试'),
    createEmptyFamily(),
  )
  return family
}

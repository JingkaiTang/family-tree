import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyFamily, createEmptyMeta, type FamilyData } from '@/core/schema'
import { mk } from '@/__tests__/fixtures/families'
import { useFamilyStore } from '@/stores/family'
import { createAutosaveController } from './autosave'

describe('autosave coordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces every revision instead of only the first dirty transition', async () => {
    vi.useFakeTimers()
    const family = openedFamily()
    const save = vi.fn(async (_path: string, _data: FamilyData) => {})
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
    const save = vi.fn((_path: string, data: FamilyData) => new Promise<void>(resolve => {
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
})

function openedFamily() {
  const family = useFamilyStore()
  family.setProject('/tmp/test.family', createEmptyMeta('测试'), createEmptyFamily())
  return family
}

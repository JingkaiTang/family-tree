/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import TreeView from '@/pages/TreeView.vue'
import { useFamilyStore } from '@/stores/family'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/services/autosave', () => ({ flushNow: vi.fn() }))
vi.mock('@/services/tauriApi', () => ({ gcMedia: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-member') }))

const FamilyCanvasStub = defineComponent({
  name: 'FamilyCanvas',
  emits: ['row-order-change'],
  setup(_, { emit }) {
    return () => h('button', {
      'data-testid': 'reorder-row',
      onClick: () => emit('row-order-change', 'row:0', [
        'unit:person:b',
        'unit:person:a',
      ]),
    })
  },
})

describe('TreeView row order integration', () => {
  it('persists the row order emitted by FamilyCanvas through the family store', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const wrapper = mount(TreeView, {
      global: {
        plugins: [pinia],
        stubs: {
          FamilyCanvas: FamilyCanvasStub,
          SearchBar: true,
        },
      },
    })

    await wrapper.get('[data-testid="reorder-row"]').trigger('click')

    expect(family.data.layoutPreferences.rowOrders).toEqual([{
      id: 'row:0',
      unitIds: ['unit:person:b', 'unit:person:a'],
    }])
  })
})

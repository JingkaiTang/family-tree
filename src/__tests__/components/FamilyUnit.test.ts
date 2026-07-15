/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FamilyUnit from '@/components/tree/FamilyUnit.vue'
import { mk } from '@/__tests__/fixtures/families'
import type {
  PlacedPersonCard,
  PlacedFamilyUnit,
  PlacedUnionHub,
} from '@/core/family-layout/types'

const LEFT_ACCENT = '#4F7CAC'
const RIGHT_ACCENT = '#B56576'

describe('FamilyUnit root identity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('emphasizes a root family without a title or domain background', () => {
    const wrapper = mountFamilyUnit(rootFamilyUnit())

    expect(wrapper.attributes('data-root-family')).toBe('true')
    expect(wrapper.find('[data-testid="root-accent-rail"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('根')
    expect(wrapper.find('[data-testid="root-domain-background"]').exists()).toBe(false)
  })

  it('renders a cross-root spouse axis with both source accents', () => {
    const wrapper = mountFamilyUnit(crossRootFamilyUnit(), {
      'root:a': LEFT_ACCENT,
      'root:b': RIGHT_ACCENT,
    })
    const axis = wrapper.get('[data-testid="spouse-axis"]')

    expect(axis.attributes('data-root-accents')).toBe(`${LEFT_ACCENT},${RIGHT_ACCENT}`)
    expect(wrapper.findAll('[data-testid="member-root-rail"]')
      .map(node => node.attributes('data-root-accent')))
      .toEqual([LEFT_ACCENT, RIGHT_ACCENT])
  })
})

function mountFamilyUnit(
  unit: PlacedFamilyUnit,
  rootAccentById: Record<string, string> = { 'root:a': LEFT_ACCENT },
) {
  const cards: PlacedPersonCard[] = unit.memberIds.map((id, index) => ({
    id,
    unitId: unit.id,
    generation: unit.generation,
    rect: {
      x: unit.rect.x + index * 192,
      y: unit.rect.y,
      width: 168,
      height: 216,
    },
  }))
  const hubs: PlacedUnionHub[] = [{
    id: `hub:${unit.id}`,
    unitId: unit.id,
    point: { x: unit.rect.x + 180, y: unit.rect.y + 108 },
  }]
  return mount(FamilyUnit, {
    props: {
      unit,
      cards,
      hubs,
      members: unit.memberIds.map(id => mk(id)),
      rootAccentById,
      rootOrder: Object.keys(rootAccentById),
    },
    global: { plugins: [createPinia()] },
  })
}

function rootFamilyUnit(): PlacedFamilyUnit {
  return {
    id: 'unit:root-family',
    kind: 'couple',
    memberIds: ['A', 'B'],
    generation: 0,
    width: 360,
    lineageAffinity: {},
    accent: LEFT_ACCENT,
    rootSignature: ['root:a'],
    domainId: 'domain:root:a',
    memberRootIds: { A: 'root:a', B: 'root:a' },
    rootAccent: LEFT_ACCENT,
    isRootFamily: true,
    rect: { x: 48, y: 24, width: 360, height: 216 },
    order: 0,
  }
}

function crossRootFamilyUnit(): PlacedFamilyUnit {
  return {
    ...rootFamilyUnit(),
    id: 'unit:cross-root-family',
    memberIds: ['A', 'B'],
    rootSignature: ['root:a', 'root:b'],
    domainId: 'domain:bridge:root:a|root:b',
    memberRootIds: { A: 'root:a', B: 'root:b' },
    isRootFamily: false,
  }
}

import { describe, expect, it } from 'vitest'
import { largeFamily } from '@/__tests__/fixtures/families'
import { layoutFamilyTree } from '@/core/treeLayout'

const UNSAFE_DIAGNOSTIC_CODES = new Set([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
])

describe('family layout performance', () => {
  it('lays out 500 members within the agreed budget', async () => {
    const members = Object.values(largeFamily(20260711, 500))
    const startedAt = performance.now()
    const scene = await layoutFamilyTree(members)
    const duration = performance.now() - startedAt
    const enforcedBudget = process.env.FAMILY_LAYOUT_PERF_BUDGET_MS

    console.info(`[family-layout-perf] 500 members: ${duration.toFixed(2)}ms`)
    expect(scene.cards).toHaveLength(500)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])

    if (enforcedBudget) {
      expect(duration).toBeLessThan(Number(enforcedBudget))
    }
  })
})

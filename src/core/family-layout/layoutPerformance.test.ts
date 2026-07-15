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
    await layoutFamilyTree(members)
    const durations: number[] = []
    let scene = await layoutFamilyTree(members)
    for (let sample = 0; sample < 5; sample += 1) {
      const startedAt = performance.now()
      scene = await layoutFamilyTree(members)
      durations.push(performance.now() - startedAt)
    }
    durations.sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
    const enforcedBudget = process.env.FAMILY_LAYOUT_PERF_BUDGET_MS

    console.info([
      '[family-layout-perf]',
      `people=${scene.cards.length}`,
      `rootDomains=${scene.rootDomains.length}`,
      `bridgeDomains=${scene.bridgeDomains.length}`,
      `routes=${scene.routes.length}`,
      `p95=${p95.toFixed(2)}ms`,
      `samples=${durations.length}`,
    ].join(' '))
    expect(scene.cards).toHaveLength(500)
    expect(scene.rootDomains.length).toBeGreaterThanOrEqual(8)
    expect(scene.bridgeDomains.length).toBeGreaterThan(0)
    expect(scene.routes.length).toBeGreaterThan(0)
    expect(scene.diagnostics.filter(diagnostic => (
      UNSAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])

    if (enforcedBudget) {
      expect(p95).toBeLessThan(Number(enforcedBudget))
    }
  })
})

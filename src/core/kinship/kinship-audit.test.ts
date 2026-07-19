import { describe, expect, it } from 'vitest'
import { syntheticFamily200 } from '@/__tests__/fixtures/syntheticFamily200'
import { getKinship } from './index'
import { findShortestLineagePath, normalizePath } from './pathFinder'

describe('kinship audit', () => {
  it('现有 200 人测试家族中，所有谱系亲属都不得使用配偶称呼', () => {
    const family = syntheticFamily200()
    const members = family.members
    const ids = Object.keys(members)
    const failures: string[] = []

    for (const fromId of ids) {
      for (const toId of ids) {
        const lineagePath = findShortestLineagePath(fromId, toId, members)
        if (!lineagePath) continue
        const label = getKinship(fromId, toId, members)
        if (label?.includes('配偶')) {
          const path = normalizePath(lineagePath, members, fromId).map(step => step.kind).join('>')
          failures.push(`${fromId} -> ${toId}: ${label} (${path})`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('现有 200 人测试家族全视角计算不崩溃，也不暴露“某某的配偶”路径文案', () => {
    const family = syntheticFamily200()
    const members = family.members
    const ids = Object.keys(members)
    const failures: string[] = []

    for (const fromId of ids) {
      for (const toId of ids) {
        let label: string | null
        try {
          label = getKinship(fromId, toId, members)
        } catch (error) {
          failures.push(`${fromId} -> ${toId}: ${String(error)}`)
          continue
        }
        if (label?.includes('的配偶') || label === '姻亲') {
          failures.push(`${fromId} -> ${toId}: ${label}`)
        }
      }
    }

    expect(failures).toEqual([])
  })
})

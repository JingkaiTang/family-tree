import { describe, expect, it } from 'vitest'
import { syntheticFamily200 } from '@/__tests__/fixtures/syntheticFamily200'
import { getKinship } from './index'
import { findPreferredKinshipPath, findShortestLineagePath, normalizePath } from './pathFinder'

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

  it('单层末端配偶关系不能用“亲戚”掩盖未解析状态', () => {
    const members = syntheticFamily200().members
    const ids = Object.keys(members)
    const failures: string[] = []

    for (const fromId of ids) {
      for (const toId of ids) {
        const rawPath = findPreferredKinshipPath(fromId, toId, members)
        if (!rawPath) continue
        const path = normalizePath(rawPath, members, fromId)
        const spouseCount = path.filter(step => step.kind === 'spouse').length
        if (spouseCount !== 1 || path.at(-1)?.kind !== 'spouse') continue
        const label = getKinship(fromId, toId, members)
        if (label === '亲戚') failures.push(`${fromId} -> ${toId}`)
      }
    }

    expect(failures).toEqual([])
  })
})

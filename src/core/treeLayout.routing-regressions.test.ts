import { describe, expect, it } from 'vitest'
import { createEmptyFamily, type FamilyData, type Member } from './schema'
import { validateScene } from './family-layout/validateScene'
import { DEFAULT_LAYOUT_METRICS, type RouteSegment } from './family-layout/types'
import { layoutFamilyTree } from './treeLayout'

const HARD_DIAGNOSTIC_CODES = new Set([
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
])

describe('layoutFamilyTree routing regressions', () => {
  it('keeps distinct parentage ports and primary routes for one single historical parent', async () => {
    const a = member('a')
    const c = member('c')
    const d = member('d')
    const childAc = member('child-ac')
    const childAd = member('child-ad')
    linkSpouse(a, c, 'divorced')
    linkSpouse(a, d, 'divorced')
    linkParent(childAc, a)
    linkParent(childAc, c)
    linkParent(childAd, a)
    linkParent(childAd, d)
    const members = [a, c, d, childAc, childAd]

    const scene = await layoutFamilyTree(members, { data: familyData(members) })
    const repeatedSourceHubs = scene.hubs.filter(hub => (
      hub.id === 'hub:parentage:a+c' || hub.id === 'hub:parentage:a+d'
    ))
    const aCard = scene.cards.find(card => card.id === 'a')!

    expect(repeatedSourceHubs).toHaveLength(2)
    expect(new Set(repeatedSourceHubs.map(hub => hub.point.x)).size).toBe(2)
    expect(repeatedSourceHubs.map(hub => hub.point.x).sort((left, right) => left - right))
      .toEqual([
        aCard.rect.x + aCard.rect.width / 2 - 8,
        aCard.rect.x + aCard.rect.width / 2 + 8,
      ])
    expect(repeatedSourceHubs.every(hub => (
      hub.point.x > aCard.rect.x
      && hub.point.x < aCard.rect.x + aCard.rect.width
      && hub.point.y === aCard.rect.y + aCard.rect.height
    ))).toBe(true)
    expect(scene.routes.filter(route => route.kind === 'primary').map(route => route.routeOwnerId))
      .toEqual(['parentage:a+c', 'parentage:a+d'])
    expect(scene.diagnostics.filter(diagnostic => (
      HARD_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
  })

  it('allocates separate auxiliary owner ports and returns trustworthy final diagnostics', async () => {
    const a = member('a')
    const c = member('c')
    const d = member('d')
    linkSpouse(a, c, 'divorced')
    linkSpouse(a, d, 'divorced')
    const members = [d, a, c]

    const scene = await layoutFamilyTree(members, {
      data: familyData(members),
      view: { showHistoricalPartnerships: true },
      auxiliaryFocusPersonId: 'a',
    })
    const auxiliaryRoutes = scene.routes.filter(route => route.kind !== 'primary')

    expect(auxiliaryRoutes.map(route => route.routeOwnerId)).toEqual([
      'aux:partnership:historical:a+c',
      'aux:partnership:historical:a+d',
    ])
    expect(auxiliaryRoutes[0].segments.some(left => (
      auxiliaryRoutes[1].segments.some(right => positiveCollinearOverlap(left, right))
    ))).toBe(false)
    expect(auxiliaryRoutes[0].segments.some(left => (
      auxiliaryRoutes[1].segments.some(right => formsStrictFalseT(left, right))
    ))).toBe(false)
    expect(validateScene(scene, DEFAULT_LAYOUT_METRICS).filter(diagnostic => (
      HARD_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
    expect(scene.diagnostics.filter(diagnostic => (
      HARD_DIAGNOSTIC_CODES.has(diagnostic.code)
    ))).toEqual([])
  })
})

function member(id: string): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  }
}

function linkSpouse(left: Member, right: Member, type: 'married' | 'divorced') {
  left.spouses.push({ id: right.id, type })
  right.spouses.push({ id: left.id, type })
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function familyData(members: Member[]): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(value => [value.id, value])),
  }
}

function positiveCollinearOverlap(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation !== right.orientation) return false
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const [a0, a1] = left.points
  const [b0, b1] = right.points
  if (left.orientation === 'horizontal') {
    return a0.y === b0.y
      && positiveOverlap(a0.x, a1.x, b0.x, b1.x)
  }
  return a0.x === b0.x
    && positiveOverlap(a0.y, a1.y, b0.y, b1.y)
}

function formsStrictFalseT(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const leftEndpoints = [left.points[0], left.points.at(-1)!]
  const rightEndpoints = [right.points[0], right.points.at(-1)!]
  return leftEndpoints.some(point => pointStrictlyInside(point, right))
    || rightEndpoints.some(point => pointStrictlyInside(point, left))
}

function pointStrictlyInside(point: { x: number; y: number }, segment: RouteSegment): boolean {
  const [start, end] = segment.points
  if (point.x === start.x && point.y === start.y) return false
  if (point.x === end.x && point.y === end.y) return false
  if (segment.orientation === 'horizontal') {
    return point.y === start.y
      && point.x > Math.min(start.x, end.x)
      && point.x < Math.max(start.x, end.x)
  }
  return point.x === start.x
    && point.y > Math.min(start.y, end.y)
    && point.y < Math.max(start.y, end.y)
}

function positiveOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(Math.min(a0, a1), Math.min(b0, b1))
    < Math.min(Math.max(a0, a1), Math.max(b0, b1))
}

import { describe, expect, it } from 'vitest'
import {
  discoverRootFamilies,
  isUnexpandedIncomingSpouse,
} from './discoverRootFamilies'
import {
  addedAncestorFixture,
  disconnectedRootsFixture,
  incomingSpouseFixture,
  twoRootMarriageFixture,
  unequalDepthMarriageFixture,
} from './rootLayoutTestHelpers'

describe('discoverRootFamilies', () => {
  it('groups a source couple into one visible root family', () => {
    const result = discoverRootFamilies(twoRootMarriageFixture())

    expect(result.roots.map(root => root.seedPersonIds)).toContainEqual([
      'a0',
      'a0-spouse',
    ])
  })

  it('suppresses an unexpanded incoming spouse as an independent root', () => {
    const result = discoverRootFamilies(incomingSpouseFixture())

    expect(result.roots).toEqual([expect.objectContaining({
      id: 'root:root-a+root-b',
      seedPersonIds: ['root-a', 'root-b'],
    })])
    expect(result.suppressedIncomingPersonIds).toEqual(['incoming'])
  })

  it('does not use the global minimum generation as the root criterion', () => {
    const result = discoverRootFamilies(unequalDepthMarriageFixture())

    expect(result.roots.map(root => root.id).sort()).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
  })

  it('creates roots for every disconnected primary component', () => {
    const result = discoverRootFamilies(disconnectedRootsFixture())

    expect(result.roots.map(root => [root.id, root.componentId])).toEqual([
      ['root:left-a+left-b', 'component:left-a'],
      ['root:right-a+right-b', 'component:right-a'],
    ])
  })

  it('returns the same roots when projected input arrays are reversed', () => {
    const fixture = twoRootMarriageFixture()
    const reversed = {
      ...fixture,
      projected: {
        ...fixture.projected,
        people: [...fixture.projected.people].reverse(),
        primaryPartnerships: [...fixture.projected.primaryPartnerships].reverse(),
        primaryParentages: [...fixture.projected.primaryParentages].reverse(),
      },
      units: [...fixture.units].reverse(),
    }

    expect(discoverRootFamilies(reversed))
      .toEqual(discoverRootFamilies(fixture))
  })

  it('matches a root moved upward to exactly one previous root', () => {
    const result = discoverRootFamilies({
      ...addedAncestorFixture(),
      previousScene: {
        rootDomains: [{
          id: 'domain:root:a0+a0-spouse',
          rootIds: ['root:a0+a0-spouse'],
          personIds: ['a0', 'a0-spouse', 'a1'],
          accent: '#4F7CAC',
        }],
      },
    })

    expect(result.previousRootIdByRootId).toEqual({
      'root:new-a0+new-a0-spouse': 'root:a0+a0-spouse',
    })
  })
})

describe('isUnexpandedIncomingSpouse', () => {
  it('suppresses a source spouse whose visible children are all shared', () => {
    expect(isUnexpandedIncomingSpouse({
      personId: 'incoming',
      partnerId: 'descendant',
      parentIdsByChild: new Map([
        ['descendant', ['root-a', 'root-b']],
        ['shared-child', ['descendant', 'incoming']],
      ]),
      childIdsByParent: new Map([
        ['incoming', ['shared-child']],
      ]),
      parentageByChild: new Map([
        ['descendant', 'parentage:root-a+root-b'],
        ['shared-child', 'parentage:descendant+incoming'],
      ]),
    })).toBe(true)
  })

  it('keeps a source spouse with an independent visible child branch', () => {
    expect(isUnexpandedIncomingSpouse({
      personId: 'incoming',
      partnerId: 'descendant',
      parentIdsByChild: new Map([
        ['descendant', ['root-a', 'root-b']],
        ['independent-child', ['incoming']],
      ]),
      childIdsByParent: new Map([
        ['incoming', ['independent-child']],
      ]),
      parentageByChild: new Map([
        ['descendant', 'parentage:root-a+root-b'],
        ['independent-child', 'parentage:incoming'],
      ]),
    })).toBe(false)
  })
})

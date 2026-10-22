import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import { createEmptyFamily, FamilyData, type Member } from './schema'
import { normalizeFacts } from './family-graph/normalizeFacts'
import { encodeIdTuple } from './idEncoding'

function member(id: string): Member {
  return { id, firstName: id, lastName: '', gender: 'other', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
}

function familyWith(...ids: string[]) {
  return { ...createEmptyFamily(), members: Object.fromEntries(ids.map(id => [id, member(id)])) }
}

function marry(data: FamilyData, left: string, right: string) {
  data.members[left].spouses.push({ id: right, type: 'married' })
  data.members[right].spouses.push({ id: left, type: 'married' })
}

function parent(data: FamilyData, parentId: string, childId: string) {
  data.members[parentId].children.push({ id: childId, type: 'blood' })
  data.members[childId].parents.push({ id: parentId, type: 'blood' })
}

describe('V5 identifier preference migration', () => {
  it('preserves root order, columns, colors and sibling order without confusing old escape-looking IDs', () => {
    const data = familyWith('a+b', 'a%2Bb', 'l+1', 'left2', 'r%1', 'right2', 'grandchild')
    parent(data, 'a+b', 'l+1')
    parent(data, 'a+b', 'left2')
    parent(data, 'a%2Bb', 'r%1')
    parent(data, 'a%2Bb', 'right2')
    marry(data, 'l+1', 'r%1')
    parent(data, 'l+1', 'grandchild')
    parent(data, 'r%1', 'grandchild')
    const componentId = `component:${Object.keys(data.members).sort((a, b) => a.localeCompare(b))[0]}`
    const oldRoots = ['root:a+b', 'root:a%2Bb']
    const newRoots = ['root:a%2Bb', 'root:a%252Bb']
    const oldBridge = `domain:bridge:${[...oldRoots].sort((a, b) => a.localeCompare(b)).join('|')}`
    const newBridge = `domain:bridge:${encodeIdTuple([...newRoots].sort((a, b) => a.localeCompare(b)), '|')}`
    const oldUnit = 'unit:partnership:current:l+1+r%1'
    const newUnit = 'unit:partnership:current:l%2B1+r%251'
    data.siblingOrders = { 'parentage:a+b': ['left2', 'l+1'], 'parentage:a%2Bb': ['right2', 'r%1'] }
    data.layoutPreferences = {
      rootOrders: [{ componentId, rootIds: [...oldRoots].reverse() }],
      rowOrders: [{ id: 'row:domain:root:a+b:0', domainId: 'domain:root:a+b', generation: 0,
        unitIds: ['unit:person:a+b'], columns: { 'unit:person:a+b': 3 } }],
      bridgeOrders: [{ id: `row:${oldBridge}:1`, domainId: oldBridge, generation: 1,
        unitIds: [oldUnit], columns: { [oldUnit]: 7 } }],
      rootAccentAssignments: { [oldRoots[0]]: '#112233', [oldRoots[1]]: '#445566' },
      familyAccentAssignments: { [oldUnit]: '#abcdef' },
    }
    const raw = { ...data, schemaVersion: 4 }
    const before = structuredClone(raw)

    const result = migrate(raw)

    expect(result.schemaVersion).toBe(5)
    expect(result.members).toEqual(data.members)
    expect(result.siblingOrders).toEqual({ 'parentage:a%2Bb': ['left2', 'l+1'], 'parentage:a%252Bb': ['right2', 'r%1'] })
    expect(result.layoutPreferences.rootOrders).toEqual([{ componentId, rootIds: [...newRoots].reverse() }])
    expect(result.layoutPreferences.rowOrders).toEqual([{ id: 'row:domain:root:a%2Bb:0', domainId: 'domain:root:a%2Bb', generation: 0,
      unitIds: ['unit:person:a+b'], columns: { 'unit:person:a+b': 3 } }])
    expect(result.layoutPreferences.bridgeOrders).toEqual([{ id: `row:${newBridge}:1`, domainId: newBridge, generation: 1,
      unitIds: [newUnit], columns: { [newUnit]: 7 } }])
    expect(result.layoutPreferences.rootAccentAssignments).toEqual({ [newRoots[0]]: '#112233', [newRoots[1]]: '#445566' })
    expect(result.layoutPreferences.familyAccentAssignments).toEqual({ [newUnit]: '#abcdef' })
    expect(migrate(result)).toEqual(result)
    expect(raw).toEqual(before)
  })

  it('drops ambiguous old preferences while preserving both families and their relationships', () => {
    const data = familyWith('a', 'b+c', 'a+b', 'c', 'kid1', 'kid2', 'kid3', 'kid4')
    marry(data, 'a', 'b+c')
    marry(data, 'a+b', 'c')
    for (const child of ['kid1', 'kid2']) for (const id of ['a', 'b+c']) parent(data, id, child)
    for (const child of ['kid3', 'kid4']) for (const id of ['a+b', 'c']) parent(data, id, child)
    data.siblingOrders = { 'parentage:a+b+c': ['kid2', 'kid1'] }
    data.layoutPreferences.familyAccentAssignments = { 'unit:partnership:current:a+b+c': '#123456' }
    data.layoutPreferences.rootAccentAssignments = { 'root:a+b+c': '#123456' }

    const result = migrate({ ...data, schemaVersion: 4 })

    expect(result.members).toEqual(data.members)
    expect(normalizeFacts(result).facts.partnerships).toHaveLength(2)
    expect(normalizeFacts(result).facts.parentages).toHaveLength(2)
    expect(result.siblingOrders).toEqual({})
    expect(result.layoutPreferences.familyAccentAssignments).toEqual({})
    expect(result.layoutPreferences.rootAccentAssignments).toEqual({})
    expect(migrate(result)).toEqual(result)
  })

  it.each([0, 1])('preserves V%s spouse edges whose legacy NUL keys collide', version => {
    const data = familyWith('a', 'b\u0000c', 'a\u0000b', 'c')
    marry(data, 'a', 'b\u0000c')
    marry(data, 'a\u0000b', 'c')
    const result = migrate({ ...data, schemaVersion: version })
    expect(result.members).toEqual(data.members)
    expect(normalizeFacts(result).facts.partnerships).toHaveLength(2)
    expect(result.schemaVersion).toBe(5)
  })

  it.each([2, 3])('converts V%s rows once and preserves literal plus and percent member IDs', version => {
    const data = familyWith('a+b', 'c%2B', 'z')
    marry(data, 'a+b', 'c%2B')
    const raw = { ...data, schemaVersion: version,
      gridLayoutOverrides: { 'couple:a+b+c%2B': { order: -1 }, 'person:z': { order: 1 } },
      layoutPreferences: version === 3 ? { rowOrders: [{ id: 'custom:0', unitIds: ['unit:partnership:current:a+b+c%2B', 'unit:person:z'] }],
        familyAccentAssignments: { 'unit:partnership:current:a+b+c%2B': '#123456' } } : undefined,
    }
    const result = migrate(raw)
    expect(result.layoutPreferences.rowOrders[0]?.unitIds).toEqual(['unit:partnership:current:a%2Bb+c%252B', 'unit:person:z'])
    if (version === 3) expect(result.layoutPreferences.familyAccentAssignments).toEqual({ 'unit:partnership:current:a%2Bb+c%252B': '#123456' })
    expect(result.members).toEqual(data.members)
    expect(migrate(result)).toEqual(result)
    expect(FamilyData.safeParse(result).success).toBe(true)
  })

  it('drops a colliding V2 couple override instead of choosing the first family', () => {
    const data = familyWith('a', 'b+c', 'a+b', 'c')
    marry(data, 'a', 'b+c')
    marry(data, 'a+b', 'c')
    const result = migrate({ ...data, schemaVersion: 2,
      gridLayoutOverrides: { 'couple:a+b+c': { order: -5 } },
    })
    expect(result.layoutPreferences.rowOrders).toEqual([])
    expect(result.members).toEqual(data.members)
  })

  it('drops an ambiguous bridge domain without applying its columns to either family', () => {
    const roots = ['a|root:b', 'c', 'a', 'b|root:c']
    const children = roots.map((_, index) => `child-${index}`)
    const data = familyWith(...roots, ...children)
    roots.forEach((id, index) => parent(data, id, children[index]))
    marry(data, children[0], children[1])
    marry(data, children[2], children[3])
    const domainId = 'domain:bridge:root:a|root:b|root:c'
    const unitId = 'unit:partnership:current:child-0+child-1'
    data.layoutPreferences.bridgeOrders = [{ id: `row:${domainId}:1`, domainId, generation: 1,
      unitIds: [unitId], columns: { [unitId]: 6 } }]
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.layoutPreferences.bridgeOrders).toEqual([])
    expect(result.members).toEqual(data.members)
  })

  it('retains order inherited from a separated couple with special IDs', () => {
    const data = familyWith('a+b', 'c%2B', 'z')
    const result = migrate({ ...data, schemaVersion: 3, layoutPreferences: {
      rowOrders: [{ id: 'custom:0', unitIds: ['unit:person:z', 'unit:partnership:current:a+b+c%2B'] }],
    } })
    expect(result.layoutPreferences.rowOrders[0].unitIds).toEqual([
      'unit:person:z', 'unit:person:a+b', 'unit:person:c%2B',
    ])
    expect(migrate(result)).toEqual(result)
  })

  it('preserves the legacy spellings of collation-equivalent parent and spouse IDs', () => {
    const data = familyWith('é', 'e\u0301', 'z1', 'z2', 'y', 'ychild')
    marry(data, 'é', 'e\u0301')
    for (const child of ['z1', 'z2']) for (const id of ['é', 'e\u0301']) parent(data, id, child)
    parent(data, 'y', 'ychild')
    marry(data, 'z1', 'ychild')
    data.siblingOrders = { 'parentage:é+e\u0301': ['z2', 'z1'] }
    data.layoutPreferences.rootOrders = [{ componentId: 'component:é', rootIds: ['root:y', 'root:é+e\u0301'] }]
    data.layoutPreferences.rootAccentAssignments = { 'root:é+e\u0301': '#123456' }
    data.layoutPreferences.familyAccentAssignments = { 'unit:partnership:current:é+e\u0301': '#123456' }
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.siblingOrders).toEqual({ 'parentage:e\u0301+é': ['z2', 'z1'] })
    expect(result.layoutPreferences.rootOrders).toEqual([{ componentId: 'component:e\u0301', rootIds: ['root:y', 'root:e\u0301+é'] }])
    expect(result.layoutPreferences.rootAccentAssignments).toEqual({ 'root:e\u0301+é': '#123456' })
    expect(result.layoutPreferences.familyAccentAssignments).toEqual({ 'unit:partnership:current:e\u0301+é': '#123456' })
    expect(normalizeFacts(result).facts.partnerships).toHaveLength(2)
    expect(result.members).toEqual(data.members)
    expect(migrate(result)).toEqual(result)
  })

  it('keeps an empty member ID distinct from the literal empty-part marker', () => {
    const data = familyWith('', '%e', 'z')
    marry(data, '', 'z')
    data.layoutPreferences.rootAccentAssignments = { 'root:+z': '#123456', 'root:%e': '#abcdef' }
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.layoutPreferences.rootAccentAssignments).toEqual({ 'root:%e+z': '#123456', 'root:%25e': '#abcdef' })
    expect(result.members).toEqual(data.members)
    expect(migrate(result)).toEqual(result)
  })

  it.each(['', '|suffix'])('preserves an old bridge collation tie with literal delimiter suffix %j', suffix => {
    const composed = `é${suffix}`
    const decomposed = `e\u0301${suffix}`
    const data = familyWith(composed, decomposed, 'left-child', 'right-child')
    parent(data, composed, 'left-child')
    parent(data, decomposed, 'right-child')
    marry(data, 'left-child', 'right-child')
    const oldDomain = `domain:bridge:root:${composed}|root:${decomposed}`
    const newDomain = `domain:bridge:${encodeIdTuple([`root:${decomposed}`, `root:${composed}`], '|')}`
    const unit = 'unit:partnership:current:left-child+right-child'
    data.layoutPreferences.bridgeOrders = [{ id: `row:${oldDomain}:1`, domainId: oldDomain,
      generation: 1, unitIds: [unit], columns: { [unit]: 7 } }]
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.layoutPreferences.bridgeOrders).toEqual([{ id: `row:${newDomain}:1`, domainId: newDomain,
      generation: 1, unitIds: [unit], columns: { [unit]: 7 } }])
    expect(migrate(result)).toEqual(result)
  })

  it('preserves the row and columns of a multi-root island with an old collation tie', () => {
    const data = familyWith('é', 'e\u0301', 'y', 'left-child', 'right-child', 'other-child', 'last-child')
    for (const [root, child] of [['é', 'left-child'], ['e\u0301', 'right-child'], ['e\u0301', 'other-child'], ['y', 'last-child']]) {
      parent(data, root, child)
    }
    marry(data, 'left-child', 'right-child')
    marry(data, 'other-child', 'last-child')
    const oldDomain = 'domain:island:root:é|root:e\u0301|root:y'
    const newDomain = 'domain:island:root:e\u0301|root:é|root:y'
    const units = ['unit:partnership:current:left-child+right-child', 'unit:partnership:current:last-child+other-child']
    data.layoutPreferences.bridgeOrders = [{ id: 'custom-island-row', domainId: oldDomain,
      generation: 1, unitIds: units, columns: { [units[0]]: 7, [units[1]]: 9 } }]
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.layoutPreferences.bridgeOrders).toEqual([{ id: 'custom-island-row', domainId: newDomain,
      generation: 1, unitIds: units, columns: { [units[0]]: 7, [units[1]]: 9 } }])
    expect(migrate(result)).toEqual(result)
  })

  it('does not move a separated couple root preference onto a same-spelled singleton', () => {
    const data = familyWith('a', 'b', 'a+b')
    data.layoutPreferences.rootAccentAssignments = { 'root:a+b': '#123456' }
    data.layoutPreferences.rowOrders = [{ id: 'custom', domainId: 'domain:root:a+b', generation: 0,
      unitIds: ['unit:person:a+b'], columns: { 'unit:person:a+b': 6 } }]
    const result = migrate({ ...data, schemaVersion: 4 })
    expect(result.layoutPreferences.rootAccentAssignments).toEqual({})
    expect(result.layoutPreferences.rowOrders).toEqual([])
    expect(result.members).toEqual(data.members)
  })
})

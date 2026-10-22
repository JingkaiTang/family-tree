import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFamilyStore } from './family'
import { addParent, mk } from '@/__tests__/fixtures/families'
import { createEmptyFamily, createEmptyMeta } from '@/core/schema'
import { validateFamilyIntegrity } from '@/core/familyIntegrity'

describe('family store relation invariants', () => {
  it('blocks domain edits before changing a read-only project', () => {
    const family = useFamilyStore()
    family.setProject({ providerId: 'reader', id: 'shared', displayName: '共享家谱' },
      createEmptyMeta('共享家谱'), { ...createEmptyFamily(), members: { a: mk('a') } },
      { canEdit: false, canRename: false })
    const before = JSON.stringify(family.data)
    expect(() => family.updateMember('a', { firstName: 'changed' })).toThrow('仅查看')
    expect(() => family.deleteMember('a')).toThrow('仅查看')
    expect(() => family.setRootMember('a')).toThrow('仅查看')
    expect(JSON.stringify(family.data)).toBe(before)
    expect(family.isDirty).toBe(false)
  })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports current spouse conflicts before replacing a spouse', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    expect(family.getCurrentSpouseConflicts('a', 'c')).toEqual(['b'])
    expect(family.getCurrentSpouseConflicts('b', 'c')).toEqual(['a'])
  })

  it.each((['blood', 'adopted', 'step'] as const).flatMap(type => (
    [false, true].flatMap(indirect => (['parent', 'child'] as const)
      .map(kind => ({ type, indirect, kind })))
  )))('rejects $type ancestry cycles ($kind, indirect=$indirect) before changing state', ({ type, indirect, kind }) => {
    const family = useFamilyStore()
    const ancestor = mk('ancestor')
    const child = mk('child')
    const grandchild = mk('grandchild')
    addParent(child, ancestor, type)
    if (indirect) addParent(grandchild, child, type)
    family.$patch(state => {
      state.data.members = { ancestor, child, grandchild }
    })
    family.markClean()
    const descendantId = indirect ? 'grandchild' : 'child'
    const before = JSON.stringify(family.data)
    const revision = family.revision

    expect(() => kind === 'parent'
      ? family.linkRelation('ancestor', descendantId, kind)
      : family.linkRelation(descendantId, 'ancestor', kind))
      .toThrow('祖先')

    expect(JSON.stringify(family.data)).toBe(before)
    expect(family.revision).toBe(revision)
    expect(family.isDirty).toBe(false)
  })

  it.each(['blood', 'adopted', 'step'] as const)('allows an existing %s parent edge without changing its type', type => {
    const family = useFamilyStore()
    const parent = mk('parent')
    const child = mk('child')
    addParent(child, parent, type)
    family.$patch(state => {
      state.data.members = { parent, child }
    })

    expect(() => family.linkRelation('child', 'parent', 'parent')).not.toThrow()
    expect(() => family.linkRelation('parent', 'child', 'child')).not.toThrow()
    expect(child.parents).toEqual([{ id: 'parent', type }])
    expect(parent.children).toEqual([{ id: 'child', type }])
    expect(validateFamilyIntegrity(family.data)).toEqual([])
  })

  it('only marks the exact saved project revision as clean', () => {
    const family = useFamilyStore()
    const token = family.projectToken

    family.upsertMember(mk('a'))
    const firstRevision = family.revision
    family.updateMember('a', { firstName: '新名字' })

    expect(family.markSaved(token, firstRevision)).toBe(false)
    expect(family.isDirty).toBe(true)
    expect(family.markSaved(token, family.revision)).toBe(true)
    expect(family.isDirty).toBe(false)
  })

  it('owns a copy of the selected project reference', () => {
    const family = useFamilyStore()
    const project = {
      providerId: 'test-provider',
      id: 'project-a',
      displayName: '项目 A',
    }

    family.setProject(project, createEmptyMeta('项目 A'), createEmptyFamily())
    project.providerId = 'another-provider'
    project.id = 'project-b'
    project.displayName = '项目 B'

    expect(family.projectRef).toEqual({
      providerId: 'test-provider',
      id: 'project-a',
      displayName: '项目 A',
    })
  })

  it('does not mark a newly opened project clean from a previous session save', () => {
    const family = useFamilyStore()
    family.setProject(
      { providerId: 'provider-a', id: 'same-id', displayName: '项目 A' },
      createEmptyMeta('项目 A'),
      createEmptyFamily(),
    )
    family.upsertMember(mk('a'))
    const savedToken = family.projectToken
    const savedRevision = family.revision
    family.setProject(
      { providerId: 'provider-b', id: 'same-id', displayName: '项目 B' },
      createEmptyMeta('项目 B'),
      createEmptyFamily(),
    )
    family.upsertMember(mk('b'))

    expect(family.revision).toBe(savedRevision)
    expect(family.markSaved(savedToken, savedRevision)).toBe(false)
    expect(family.isDirty).toBe(true)

    family.closeProject()
    expect(family.projectRef).toBeNull()
    expect(family.projectMeta).toBeNull()
    expect(family.lastSavedAt).toBeNull()
  })

  it('does not replace a conflicting current spouse without explicit replacement', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    const result = family.linkCurrentSpouse('a', 'c')

    expect(result).toEqual({ ok: false, conflicts: ['b'] })
    expect(family.data.members.a.spouses).toEqual([{ id: 'b', type: 'married' }])
    expect(family.data.members.c.spouses).toEqual([])
  })

  it('replaces current spouse after confirmation path', () => {
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })

    const result = family.linkCurrentSpouse('a', 'c', { replaceConflicts: true })

    expect(result).toEqual({ ok: true, conflicts: ['b'] })
    expect(family.data.members.a.spouses).toEqual([{ id: 'c', type: 'married' }])
    expect(family.data.members.b.spouses).toEqual([])
    expect(family.data.members.c.spouses).toEqual([{ id: 'a', type: 'married' }])
  })

  it('stores child layout assignment and grid override', () => {
    const family = useFamilyStore()
    const parent = mk('parent')
    const spouse = mk('spouse')
    const child = mk('child')
    family.$patch((state) => {
      state.data.members = { parent, spouse, child }
    })

    family.setChildLayoutAssignment('child', {
      primaryParentId: 'parent',
      primarySpouseId: 'spouse',
    })
    family.setGridLayoutOverride('couple:parent+spouse', { order: 3 })

    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
      primarySpouseId: 'spouse',
    })
    expect(family.data.gridLayoutOverrides['couple:parent+spouse']).toEqual({ order: 3 })
  })

  it('stores unique semantic row order without writing legacy layout fields', () => {
    const family = useFamilyStore()

    family.setRowOrderPreference('row:0', [
      'unit:person:b',
      'unit:person:a',
      'unit:person:b',
    ])
    family.setRowOrderPreference('row:0', ['unit:person:a'])

    expect(family.data.layoutPreferences.rowOrders).toEqual([{
      id: 'row:0',
      domainId: 'legacy',
      generation: 0,
      unitIds: ['unit:person:a'],
    }])
    expect(family.data.manualPositions).toEqual({})
    expect(family.data.gridLayoutOverrides).toEqual({})
    expect(family.isDirty).toBe(true)
  })

  it('keeps the all-order reset idempotent when only a row order exists', () => {
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.members.child = mk('child')
      state.data.layoutPreferences = {
        rootOrders: [],
        rowOrders: [{
          id: 'row:0',
          domainId: 'legacy',
          generation: 0,
          unitIds: ['unit:person:b', 'unit:person:a'],
        }],
        bridgeOrders: [],
        rootAccentAssignments: {},
        familyAccentAssignments: {
          'unit:person:a': '#123456',
        },
      }
      state.data.childLayoutAssignments.child = {
        primaryParentId: 'parent',
      }
    })
    family.markClean()

    family.clearAllLayoutOrderPreferences()

    expect(family.data.layoutPreferences).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#123456',
      },
    })
    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
    })
    expect(family.isDirty).toBe(true)

    family.markClean()
    family.clearAllLayoutOrderPreferences()
    expect(family.isDirty).toBe(false)
  })

  it('clears every manual layout order and preserves accent assignments', () => {
    const family = useFamilyStore()
    family.$patch(state => {
      state.data.layoutPreferences = {
        rootOrders: [{ componentId: 'component:a', rootIds: ['root:b', 'root:a'] }],
        rowOrders: [{
          id: 'root:a:0',
          domainId: 'domain:root:a',
          generation: 0,
          unitIds: ['unit:b', 'unit:a'],
        }],
        bridgeOrders: [{
          id: 'bridge:a+b:1',
          domainId: 'domain:bridge:a+b',
          generation: 1,
          unitIds: ['unit:cross-2', 'unit:cross-1'],
        }],
        rootAccentAssignments: { 'root:a': '#345678' },
        familyAccentAssignments: { 'unit:a': '#123456' },
      }
    })

    family.clearAllLayoutOrderPreferences()

    expect(family.data.layoutPreferences).toMatchObject({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: { 'root:a': '#345678' },
      familyAccentAssignments: { 'unit:a': '#123456' },
    })
  })

  it('stores root, domain-row and bridge order preferences idempotently', () => {
    const family = useFamilyStore()
    family.setRootOrderPreference('component:main', ['root:b', 'root:a', 'root:b'])
    family.setDomainRowOrderPreference({
      id: 'row:root:a:1',
      domainId: 'domain:root:a',
      generation: 1,
      unitIds: ['unit:b', 'unit:a', 'unit:b'],
    })
    family.setBridgeOrderPreference({
      id: 'row:bridge:a+b:2',
      domainId: 'domain:bridge:a+b',
      generation: 2,
      unitIds: ['unit:cross-b', 'unit:cross-a', 'unit:cross-b'],
    })

    expect(family.data.layoutPreferences).toMatchObject({
      rootOrders: [{
        componentId: 'component:main',
        rootIds: ['root:b', 'root:a'],
      }],
      rowOrders: [{
        id: 'row:root:a:1',
        domainId: 'domain:root:a',
        generation: 1,
        unitIds: ['unit:b', 'unit:a'],
      }],
      bridgeOrders: [{
        id: 'row:bridge:a+b:2',
        domainId: 'domain:bridge:a+b',
        generation: 2,
        unitIds: ['unit:cross-b', 'unit:cross-a'],
      }],
    })

    family.markClean()
    family.setRootOrderPreference('component:main', ['root:b', 'root:a'])
    expect(family.isDirty).toBe(false)
  })

  it('persists and clears family accent assignments', () => {
    const family = useFamilyStore()

    family.setFamilyAccentAssignment('unit:person:a', '#123456')
    expect(family.data.layoutPreferences.familyAccentAssignments).toEqual({
      'unit:person:a': '#123456',
    })

    family.setFamilyAccentAssignment('unit:person:a', null)
    expect(family.data.layoutPreferences.familyAccentAssignments).toEqual({})
  })

  it('reconciles semantic layout preferences after deleting a member', () => {
    const family = useFamilyStore()
    family.$patch((state) => {
      state.data.members = {
        a: mk('a'),
        b: mk('b'),
      }
      state.data.layoutPreferences = {
        rootOrders: [],
        rowOrders: [{
          id: 'row:dirty',
          domainId: 'legacy',
          generation: 0,
          unitIds: [
            'unit:person:b',
            'unit:person:a',
            'unit:person:b',
            'unit:person:unknown',
          ],
        }],
        bridgeOrders: [],
        rootAccentAssignments: {},
        familyAccentAssignments: {
          'unit:person:a': '#111111',
          'unit:person:b': '#222222',
          'unit:person:unknown': '#999999',
        },
      }
    })

    family.deleteMember('b')

    expect(family.data.layoutPreferences).toEqual({
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {
        'unit:person:a': '#111111',
      },
    })
  })

  it.each([
    { deletedId: 'child', expectedChild: undefined, expectedOnlyParent: { primaryParentId: 'parent' } },
    { deletedId: 'parent', expectedChild: { primarySpouseId: 'spouse' }, expectedOnlyParent: undefined },
    { deletedId: 'spouse', expectedChild: { primaryParentId: 'parent' }, expectedOnlyParent: { primaryParentId: 'parent' } },
  ])('cleans legacy layout references when deleting $deletedId', ({ deletedId, expectedChild, expectedOnlyParent }) => {
    const family = useFamilyStore()
    for (const id of ['parent', 'spouse', 'child', 'onlyParent', 'unrelatedParent', 'unrelatedChild']) {
      family.upsertMember(mk(id))
    }
    family.setChildLayoutAssignment('child', { primaryParentId: 'parent', primarySpouseId: 'spouse' })
    family.setChildLayoutAssignment('onlyParent', { primaryParentId: 'parent' })
    family.setChildLayoutAssignment('unrelatedChild', { primaryParentId: 'unrelatedParent' })

    family.deleteMember(deletedId)

    expect(family.data.childLayoutAssignments.child).toEqual(expectedChild)
    expect(family.data.childLayoutAssignments.onlyParent).toEqual(expectedOnlyParent)
    expect(family.data.childLayoutAssignments.unrelatedChild).toEqual({ primaryParentId: 'unrelatedParent' })
  })
})

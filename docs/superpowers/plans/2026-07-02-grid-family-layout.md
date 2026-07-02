# Grid Family Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default free-coordinate family layout with a generation-row and grid-slot layout that enforces one current spouse per member, supports child primary layout ownership, and preserves legacy data safely.

**Architecture:** Add V2 schema fields and migration first, then add store APIs that enforce current-spouse conflicts and child layout ownership. Build a new `GridFamilyModel` and `gridFamilyLayout` engine beside the existing constraint engine, switch the public `layoutFamilyTree` facade to the grid engine, and update drag/drop plus relation editing to write grid intent instead of free coordinates.

**Tech Stack:** Vue 3, Pinia, TypeScript, Zod, Vitest, existing `LayoutResult` canvas renderer.

---

## Scope Check

This plan implements one coherent feature: the default family tree layout model. It touches schema, migration, store relation semantics, the layout engine, and the two UI entry points that write layout intent. The tasks are ordered so each milestone is testable and commit-worthy.

## File Structure

- `src/core/schema.ts`: V2 schema fields for child layout assignments and grid layout overrides.
- `src/core/migrate.ts`: V1-to-V2 migration with deterministic spouse conflict normalization and default child assignment inference.
- `src/core/migrate.test.ts`: migration regression tests.
- `src/stores/family.ts`: store-level current-spouse conflict helpers, child assignment setters, and grid override setters.
- `src/stores/family.test.ts`: store relation and override tests.
- `src/core/layout/gridFamilyModel.ts`: semantic grid model builder.
- `src/core/layout/gridFamilyModel.test.ts`: grid model unit tests.
- `src/core/layout/gridFamilyLayout.ts`: grid layout engine that emits `LayoutResult`.
- `src/core/layout/gridFamilyLayout.test.ts`: layout engine tests.
- `src/core/treeLayout.ts`: public layout facade.
- `src/core/treeLayout.test.ts`: facade expectations updated for grid semantics.
- `src/core/elkLayout.ts`: extend `LayoutResult` with optional grid metadata while preserving old engines.
- `src/components/tree/FamilyCanvas.vue`: drag/drop writes slot order overrides.
- `src/__tests__/components/FamilyCanvas.test.ts`: component tests for grid override persistence.
- `src/components/member/RelationEditor.vue`: child primary assignment UI and spouse conflict confirmation.
- `src/__tests__/components/RelationEditor.test.ts`: relation editor behavior tests.

---

### Task 1: Add V2 Schema And Migration

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/migrate.ts`
- Create: `src/core/migrate.test.ts`

- [ ] **Step 1: Write failing migration tests**

Create `src/core/migrate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import { SCHEMA_VERSION, type FamilyData, type Member } from './schema'

function member(id: string, patch: Partial<Member> = {}): Member {
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
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member, type: 'married' | 'divorced' = 'married') {
  a.spouses.push({ id: b.id, type })
  b.spouses.push({ id: a.id, type })
}

function rawFamily(members: Member[], patch: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    nicknameOverrides: {},
    manualPositions: {},
    ...patch,
  }
}

describe('migrate', () => {
  it('adds V2 grid fields while preserving legacy manualPositions', () => {
    const a = member('a')
    const raw = rawFamily([a], { manualPositions: { a: { cx: 10, top: 20 } } })

    const migrated = migrate(raw)

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.manualPositions.a).toEqual({ cx: 10, top: 20 })
    expect(migrated.childLayoutAssignments).toEqual({})
    expect(migrated.gridLayoutOverrides).toEqual({})
  })

  it('normalizes multiple current spouses deterministically', () => {
    const a = member('a')
    const b = member('b')
    const c = member('c')
    linkSpouse(a, c)
    linkSpouse(a, b)

    const migrated = migrate(rawFamily([a, b, c]))

    expect(migrated.members.a.spouses).toEqual([
      { id: 'b', type: 'married' },
      { id: 'c', type: 'divorced' },
    ])
    expect(migrated.members.b.spouses).toEqual([{ id: 'a', type: 'married' }])
    expect(migrated.members.c.spouses).toEqual([{ id: 'a', type: 'divorced' }])
  })

  it('infers child layout assignment from current-spouse parents', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const migrated = migrate(rawFamily([dad, mom, kid]))

    expect(migrated.childLayoutAssignments.kid).toEqual({
      primaryParentId: 'dad',
      primarySpouseId: 'mom',
    })
  })

  it('infers child layout assignment from stable first parent when parents are not current spouses', () => {
    const zParent = member('zParent')
    const aParent = member('aParent')
    const kid = member('kid')
    linkParent(kid, zParent)
    linkParent(kid, aParent)

    const migrated = migrate(rawFamily([zParent, aParent, kid]))

    expect(migrated.childLayoutAssignments.kid).toEqual({
      primaryParentId: 'aParent',
    })
  })
})
```

- [ ] **Step 2: Run migration tests and verify failure**

Run:

```bash
npm.cmd test -- src/core/migrate.test.ts
```

Expected: fails because `childLayoutAssignments` and `gridLayoutOverrides` are not in the schema or migration output.

- [ ] **Step 3: Add V2 schema fields**

Modify `src/core/schema.ts`:

```ts
export const SCHEMA_VERSION = 2
```

Add below `ManualPositions`:

```ts
export const ChildLayoutAssignment = z.object({
  primaryParentId: z.string().optional(),
  primarySpouseId: z.string().optional(),
})
export type ChildLayoutAssignment = z.infer<typeof ChildLayoutAssignment>
export const ChildLayoutAssignments = z.record(z.string(), ChildLayoutAssignment)
export type ChildLayoutAssignments = z.infer<typeof ChildLayoutAssignments>

export const GridLayoutOverride = z.object({
  order: z.number(),
})
export type GridLayoutOverride = z.infer<typeof GridLayoutOverride>
export const GridLayoutOverrides = z.record(z.string(), GridLayoutOverride)
export type GridLayoutOverrides = z.infer<typeof GridLayoutOverrides>
```

Add to `FamilyData`:

```ts
  childLayoutAssignments: ChildLayoutAssignments.default({}),
  gridLayoutOverrides: GridLayoutOverrides.default({}),
```

Add to `createEmptyFamily()`:

```ts
    childLayoutAssignments: {},
    gridLayoutOverrides: {},
```

- [ ] **Step 4: Implement V1-to-V2 migration**

Replace `src/core/migrate.ts` with:

```ts
import { type FamilyData, SCHEMA_VERSION, type Member } from './schema'

type MutableFamily = Record<string, unknown> & {
  schemaVersion: number
  members?: Record<string, Member>
  childLayoutAssignments?: FamilyData['childLayoutAssignments']
  gridLayoutOverrides?: FamilyData['gridLayoutOverrides']
}

export function migrate(raw: unknown): FamilyData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('家族数据格式无效（根节点不是对象）')
  }

  const data = raw as Record<string, unknown>
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0
  let current: MutableFamily = { ...data, schemaVersion: version }

  if (current.schemaVersion < 2) {
    current = migrateV1ToV2(current)
  }

  current.schemaVersion = SCHEMA_VERSION
  return current as unknown as FamilyData
}

function migrateV1ToV2(data: MutableFamily): MutableFamily {
  const members = data.members ?? {}
  normalizeCurrentSpouses(members)
  return {
    ...data,
    members,
    childLayoutAssignments: inferChildLayoutAssignments(members),
    gridLayoutOverrides: {},
    schemaVersion: 2,
  }
}

function normalizeCurrentSpouses(members: Record<string, Member>) {
  for (const member of Object.values(members)) {
    const marriedIds = member.spouses
      .filter((spouse) => spouse.type === 'married' && members[spouse.id])
      .map((spouse) => spouse.id)
      .sort(compareIds)

    const keepId = marriedIds[0]
    member.spouses = member.spouses
      .filter((spouse, index, spouses) =>
        members[spouse.id] && spouses.findIndex((candidate) => candidate.id === spouse.id) === index,
      )
      .map((spouse) => ({
        ...spouse,
        type: spouse.type === 'married' && spouse.id !== keepId ? 'divorced' : spouse.type,
      }))
      .sort((left, right) => compareIds(left.id, right.id))
  }

  for (const member of Object.values(members)) {
    for (const spouse of member.spouses) {
      const other = members[spouse.id]
      if (!other) continue
      const reverse = other.spouses.find((candidate) => candidate.id === member.id)
      if (reverse) reverse.type = spouse.type
    }
  }
}

function inferChildLayoutAssignments(
  members: Record<string, Member>,
): FamilyData['childLayoutAssignments'] {
  const assignments: FamilyData['childLayoutAssignments'] = {}
  for (const child of Object.values(members)) {
    const parentIds = child.parents
      .map((parent) => parent.id)
      .filter((id) => Boolean(members[id]))
      .sort(compareIds)
    if (parentIds.length === 0) continue

    const spousePair = findCurrentSpouseParentPair(parentIds, members)
    if (spousePair) {
      assignments[child.id] = {
        primaryParentId: spousePair[0],
        primarySpouseId: spousePair[1],
      }
      continue
    }

    assignments[child.id] = { primaryParentId: parentIds[0] }
  }
  return assignments
}

function findCurrentSpouseParentPair(
  parentIds: string[],
  members: Record<string, Member>,
): [string, string] | null {
  for (const parentId of parentIds) {
    const spouseId = members[parentId]?.spouses.find((spouse) =>
      spouse.type === 'married' && parentIds.includes(spouse.id),
    )?.id
    if (!spouseId) continue
    return [parentId, spouseId].sort(compareIds) as [string, string]
  }
  return null
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}
```

- [ ] **Step 5: Run migration tests and typecheck**

Run:

```bash
npm.cmd test -- src/core/migrate.test.ts
npm.cmd run typecheck
```

Expected: migration tests pass; typecheck exits 0.

- [ ] **Step 6: Commit schema and migration**

```bash
git add src/core/schema.ts src/core/migrate.ts src/core/migrate.test.ts
git commit -m "feat: add grid layout schema migration"
```

---

### Task 2: Add Store APIs For Current Spouse And Grid Intent

**Files:**
- Modify: `src/stores/family.ts`
- Create: `src/stores/family.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `src/stores/family.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFamilyStore } from './family'
import { mk } from '@/__tests__/fixtures/families'

describe('family store relation invariants', () => {
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
})
```

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
npm.cmd test -- src/stores/family.test.ts
```

Expected: fails because the new store methods are missing.

- [ ] **Step 3: Implement store APIs**

In `src/stores/family.ts`, extend imports:

```ts
import type { ChildLayoutAssignment, FamilyData, GridLayoutOverride, Member, ProjectMeta } from '@/core/schema'
```

Add helpers inside the store before `linkRelation`:

```ts
type LinkCurrentSpouseResult = { ok: true; conflicts: string[] } | { ok: false; conflicts: string[] }

function currentSpouseId(member: Member): string | null {
  return member.spouses.find((spouse) => spouse.type === 'married')?.id ?? null
}

function getCurrentSpouseConflicts(memberId: string, otherId: string): string[] {
  const me = data.value.members[memberId]
  const other = data.value.members[otherId]
  if (!me || !other || memberId === otherId) return []
  return [currentSpouseId(me), currentSpouseId(other)]
    .filter((id): id is string => Boolean(id) && id !== memberId && id !== otherId)
    .sort((left, right) => left.localeCompare(right))
}

function removeCurrentSpouse(memberId: string) {
  const member = data.value.members[memberId]
  if (!member) return
  const spouseIds = member.spouses
    .filter((spouse) => spouse.type === 'married')
    .map((spouse) => spouse.id)
  member.spouses = member.spouses.filter((spouse) => spouse.type !== 'married')
  for (const spouseId of spouseIds) {
    const spouse = data.value.members[spouseId]
    if (!spouse) continue
    spouse.spouses = spouse.spouses.filter((ref) => !(ref.id === memberId && ref.type === 'married'))
  }
}

function linkCurrentSpouse(
  memberId: string,
  otherId: string,
  opts: { replaceConflicts?: boolean } = {},
): LinkCurrentSpouseResult {
  if (memberId === otherId) return { ok: false, conflicts: [] }
  const me = data.value.members[memberId]
  const other = data.value.members[otherId]
  if (!me || !other) return { ok: false, conflicts: [] }

  const conflicts = getCurrentSpouseConflicts(memberId, otherId)
  if (conflicts.length > 0 && !opts.replaceConflicts) {
    return { ok: false, conflicts }
  }

  removeCurrentSpouse(memberId)
  removeCurrentSpouse(otherId)
  me.spouses = me.spouses.filter((spouse) => spouse.id !== otherId)
  other.spouses = other.spouses.filter((spouse) => spouse.id !== memberId)
  me.spouses.push({ id: otherId, type: 'married' })
  other.spouses.push({ id: memberId, type: 'married' })
  me.spouses.sort((left, right) => left.id.localeCompare(right.id))
  other.spouses.sort((left, right) => left.id.localeCompare(right.id))
  markDirty()
  return { ok: true, conflicts }
}
```

In the `linkRelation` spouse branch, replace direct `ensure` calls with:

```ts
      linkCurrentSpouse(memberId, otherId)
```

Add setters near `setDefaultViewpoint`:

```ts
function setChildLayoutAssignment(id: string, assignment: ChildLayoutAssignment | null) {
  if (!data.value.members[id]) return
  if (!assignment || (!assignment.primaryParentId && !assignment.primarySpouseId)) {
    delete data.value.childLayoutAssignments[id]
  } else {
    data.value.childLayoutAssignments[id] = assignment
  }
  markDirty()
}

function setGridLayoutOverride(slotId: string, override: GridLayoutOverride | null) {
  if (!override) {
    delete data.value.gridLayoutOverrides[slotId]
  } else {
    data.value.gridLayoutOverrides[slotId] = override
  }
  markDirty()
}
```

Expose the new methods in the returned object:

```ts
    getCurrentSpouseConflicts,
    linkCurrentSpouse,
    setChildLayoutAssignment,
    setGridLayoutOverride,
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npm.cmd test -- src/stores/family.test.ts
```

Expected: all store tests pass.

- [ ] **Step 5: Commit store APIs**

```bash
git add src/stores/family.ts src/stores/family.test.ts
git commit -m "feat: enforce current spouse in store"
```

---

### Task 3: Build Grid Family Semantic Model

**Files:**
- Create: `src/core/layout/gridFamilyModel.ts`
- Create: `src/core/layout/gridFamilyModel.test.ts`

- [ ] **Step 1: Write failing grid model tests**

Create `src/core/layout/gridFamilyModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FamilyData, Member } from '@/core/schema'
import { createEmptyFamily } from '@/core/schema'
import { buildGridFamilyModel } from './gridFamilyModel'

function member(id: string, patch: Partial<Member> = {}): Member {
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
    ...patch,
  }
}

function family(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

describe('buildGridFamilyModel', () => {
  it('creates a couple slot for current spouses and one child group', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const model = buildGridFamilyModel(family([dad, mom, kid]))

    expect(model.slots.map((slot) => slot.id)).toContain('couple:dad+mom')
    expect(model.childGroups).toEqual([
      { id: 'children:couple:dad+mom', parentSlotId: 'couple:dad+mom', childIds: ['kid'] },
    ])
    expect(model.memberSlotIds.kid).toBe('person:kid')
  })

  it('uses explicit child layout assignment instead of biological parent pair', () => {
    const bioDad = member('bioDad')
    const mom = member('mom')
    const stepDad = member('stepDad')
    const kid = member('kid')
    linkSpouse(mom, stepDad)
    linkParent(kid, bioDad)
    linkParent(kid, mom)

    const model = buildGridFamilyModel(family([bioDad, mom, stepDad, kid], {
      childLayoutAssignments: {
        kid: { primaryParentId: 'mom', primarySpouseId: 'stepDad' },
      },
    }))

    expect(model.childGroups).toEqual([
      { id: 'children:couple:mom+stepDad', parentSlotId: 'couple:mom+stepDad', childIds: ['kid'] },
    ])
  })

  it('creates a single-parent slot when child assignment points to one parent', () => {
    const parent = member('parent')
    const kid = member('kid')
    linkParent(kid, parent)

    const model = buildGridFamilyModel(family([parent, kid]))

    expect(model.slots.map((slot) => slot.id)).toContain('single-parent:parent')
    expect(model.childGroups[0].parentSlotId).toBe('single-parent:parent')
  })

  it('applies grid order overrides within rows', () => {
    const a = member('a')
    const b = member('b')

    const model = buildGridFamilyModel(family([a, b], {
      gridLayoutOverrides: {
        'person:b': { order: -1 },
      },
    }))

    expect(model.rows[0].slotIds).toEqual(['person:b', 'person:a'])
  })
})
```

- [ ] **Step 2: Run grid model tests and verify failure**

Run:

```bash
npm.cmd test -- src/core/layout/gridFamilyModel.test.ts
```

Expected: fails because `gridFamilyModel.ts` does not exist.

- [ ] **Step 3: Implement grid model builder**

Create `src/core/layout/gridFamilyModel.ts`:

```ts
import type { FamilyData, Member } from '@/core/schema'

export interface GridSlot {
  id: string
  kind: 'person' | 'couple' | 'single-parent'
  memberIds: string[]
  generation: number
  order: number
}

export interface GridChildGroup {
  id: string
  parentSlotId: string
  childIds: string[]
}

export interface GridRow {
  generation: number
  slotIds: string[]
}

export interface GridFamilyModel {
  members: Member[]
  slots: GridSlot[]
  rows: GridRow[]
  childGroups: GridChildGroup[]
  memberSlotIds: Record<string, string>
}

export function buildGridFamilyModel(data: FamilyData): GridFamilyModel {
  const members = Object.values(data.members).sort((left, right) => compareIds(left.id, right.id))
  const memberById = new Map(members.map((member) => [member.id, member]))
  const generations = assignGenerations(members, memberById, data)
  const currentCouples = buildCurrentCouples(members, memberById, generations)
  const slotsById = new Map<string, GridSlot>()
  const memberSlotIds: Record<string, string> = {}

  for (const couple of currentCouples) {
    const id = coupleSlotId(couple[0], couple[1])
    const generation = Math.max(generations.get(couple[0]) ?? 0, generations.get(couple[1]) ?? 0)
    slotsById.set(id, {
      id,
      kind: 'couple',
      memberIds: couple,
      generation,
      order: defaultSlotOrder(id, data),
    })
    memberSlotIds[couple[0]] = id
    memberSlotIds[couple[1]] = id
  }

  const childGroupsBySlotId = new Map<string, string[]>()
  for (const child of members) {
    const assignment = resolveChildAssignment(child, memberById, data)
    if (!assignment) continue
    const parentSlotId = assignment.primarySpouseId
      ? coupleSlotId(assignment.primaryParentId, assignment.primarySpouseId)
      : singleParentSlotId(assignment.primaryParentId)
    const childIds = childGroupsBySlotId.get(parentSlotId) ?? []
    childIds.push(child.id)
    childGroupsBySlotId.set(parentSlotId, childIds)

    if (!assignment.primarySpouseId && !slotsById.has(parentSlotId)) {
      slotsById.set(parentSlotId, {
        id: parentSlotId,
        kind: 'single-parent',
        memberIds: [assignment.primaryParentId],
        generation: generations.get(assignment.primaryParentId) ?? 0,
        order: defaultSlotOrder(parentSlotId, data),
      })
      memberSlotIds[assignment.primaryParentId] = parentSlotId
    }
  }

  for (const member of members) {
    if (memberSlotIds[member.id]) continue
    const id = personSlotId(member.id)
    slotsById.set(id, {
      id,
      kind: 'person',
      memberIds: [member.id],
      generation: generations.get(member.id) ?? 0,
      order: defaultSlotOrder(id, data),
    })
    memberSlotIds[member.id] = id
  }

  const childGroups = [...childGroupsBySlotId.entries()]
    .map(([parentSlotId, childIds]) => ({
      id: `children:${parentSlotId}`,
      parentSlotId,
      childIds: childIds.sort((left, right) => compareMembersForChildOrder(left, right, memberById)),
    }))
    .sort((left, right) => compareIds(left.parentSlotId, right.parentSlotId))

  const slots = [...slotsById.values()].sort(compareSlots)
  const rows = buildRows(slots)

  return {
    members,
    slots,
    rows,
    childGroups,
    memberSlotIds,
  }
}

export function personSlotId(id: string): string {
  return `person:${id}`
}

export function coupleSlotId(leftId: string, rightId: string): string {
  return `couple:${[leftId, rightId].sort(compareIds).join('+')}`
}

export function singleParentSlotId(id: string): string {
  return `single-parent:${id}`
}

function assignGenerations(
  members: Member[],
  memberById: Map<string, Member>,
  data: FamilyData,
): Map<string, number> {
  const generations = new Map(members.map((member) => [member.id, 0]))
  const maxIterations = Math.max(1, members.length * members.length)

  for (let i = 0; i < maxIterations; i++) {
    let changed = false
    for (const member of members) {
      const assignment = resolveChildAssignment(member, memberById, data)
      if (!assignment) continue
      const parentGeneration = generations.get(assignment.primaryParentId) ?? 0
      if ((generations.get(member.id) ?? 0) < parentGeneration + 1) {
        generations.set(member.id, parentGeneration + 1)
        changed = true
      }
      if (assignment.primarySpouseId) {
        const spouseGeneration = generations.get(assignment.primarySpouseId) ?? parentGeneration
        const targetGeneration = Math.max(parentGeneration, spouseGeneration)
        if ((generations.get(assignment.primaryParentId) ?? 0) !== targetGeneration) {
          generations.set(assignment.primaryParentId, targetGeneration)
          changed = true
        }
        if ((generations.get(assignment.primarySpouseId) ?? 0) !== targetGeneration) {
          generations.set(assignment.primarySpouseId, targetGeneration)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  const minGeneration = Math.min(...generations.values())
  for (const [id, generation] of generations) {
    generations.set(id, generation - minGeneration)
  }
  return generations
}

function buildCurrentCouples(
  members: Member[],
  memberById: Map<string, Member>,
  generations: Map<string, number>,
): Array<[string, string]> {
  const seen = new Set<string>()
  const couples: Array<[string, string]> = []
  for (const member of members) {
    const spouseId = member.spouses.find((spouse) => spouse.type === 'married' && memberById.has(spouse.id))?.id
    if (!spouseId) continue
    const pair = [member.id, spouseId].sort(compareIds) as [string, string]
    const key = pair.join('+')
    if (seen.has(key)) continue
    seen.add(key)
    const generation = Math.max(generations.get(pair[0]) ?? 0, generations.get(pair[1]) ?? 0)
    generations.set(pair[0], generation)
    generations.set(pair[1], generation)
    couples.push(pair)
  }
  return couples.sort((left, right) => compareIds(left[0], right[0]) || compareIds(left[1], right[1]))
}

function resolveChildAssignment(
  child: Member,
  memberById: Map<string, Member>,
  data: FamilyData,
): { primaryParentId: string; primarySpouseId?: string } | null {
  const explicit = data.childLayoutAssignments[child.id]
  if (explicit?.primaryParentId && memberById.has(explicit.primaryParentId)) {
    const spouseId = explicit.primarySpouseId && memberById.has(explicit.primarySpouseId)
      ? explicit.primarySpouseId
      : undefined
    return { primaryParentId: explicit.primaryParentId, primarySpouseId: spouseId }
  }

  const parentIds = child.parents
    .map((parent) => parent.id)
    .filter((id) => memberById.has(id))
    .sort(compareIds)
  if (parentIds.length === 0) return null

  for (const parentId of parentIds) {
    const spouseId = memberById.get(parentId)?.spouses.find((spouse) =>
      spouse.type === 'married' && parentIds.includes(spouse.id),
    )?.id
    if (spouseId) {
      const pair = [parentId, spouseId].sort(compareIds)
      return { primaryParentId: pair[0], primarySpouseId: pair[1] }
    }
  }

  return { primaryParentId: parentIds[0] }
}

function defaultSlotOrder(id: string, data: FamilyData): number {
  return data.gridLayoutOverrides[id]?.order ?? 0
}

function buildRows(slots: GridSlot[]): GridRow[] {
  const slotIdsByGeneration = new Map<number, string[]>()
  for (const slot of slots) {
    const row = slotIdsByGeneration.get(slot.generation) ?? []
    row.push(slot.id)
    slotIdsByGeneration.set(slot.generation, row)
  }

  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  return [...slotIdsByGeneration.entries()]
    .sort(([left], [right]) => left - right)
    .map(([generation, slotIds]) => ({
      generation,
      slotIds: slotIds.sort((leftId, rightId) => {
        const left = slotById.get(leftId)!
        const right = slotById.get(rightId)!
        return left.order - right.order || compareIds(left.id, right.id)
      }),
    }))
}

function compareSlots(left: GridSlot, right: GridSlot): number {
  return left.generation - right.generation || left.order - right.order || compareIds(left.id, right.id)
}

function compareMembersForChildOrder(
  leftId: string,
  rightId: string,
  memberById: Map<string, Member>,
): number {
  const leftBirth = memberById.get(leftId)?.birthDate
  const rightBirth = memberById.get(rightId)?.birthDate
  if (leftBirth && rightBirth && leftBirth !== rightBirth) return leftBirth.localeCompare(rightBirth)
  if (leftBirth && !rightBirth) return -1
  if (!leftBirth && rightBirth) return 1
  return compareIds(leftId, rightId)
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}
```

- [ ] **Step 4: Run grid model tests**

Run:

```bash
npm.cmd test -- src/core/layout/gridFamilyModel.test.ts
```

Expected: all grid model tests pass.

- [ ] **Step 5: Commit grid model**

```bash
git add src/core/layout/gridFamilyModel.ts src/core/layout/gridFamilyModel.test.ts
git commit -m "feat: add grid family model"
```

---

### Task 4: Add Grid Layout Engine

**Files:**
- Modify: `src/core/elkLayout.ts`
- Create: `src/core/layout/gridFamilyLayout.ts`
- Create: `src/core/layout/gridFamilyLayout.test.ts`

- [ ] **Step 1: Write failing grid layout tests**

Create `src/core/layout/gridFamilyLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FamilyData, Member } from '@/core/schema'
import { createEmptyFamily } from '@/core/schema'
import { layoutGridFamilyTree } from './gridFamilyLayout'

function member(id: string, patch: Partial<Member> = {}): Member {
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
    ...patch,
  }
}

function data(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    ...patch,
  }
}

function linkParent(child: Member, parent: Member) {
  child.parents.push({ id: parent.id, type: 'blood' })
  parent.children.push({ id: child.id, type: 'blood' })
}

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

describe('layoutGridFamilyTree', () => {
  it('places current spouses on the same row and children below', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = await layoutGridFamilyTree(data([dad, mom, kid]))

    const dadNode = result.nodes.find((node) => node.id === 'dad')!
    const momNode = result.nodes.find((node) => node.id === 'mom')!
    const kidNode = result.nodes.find((node) => node.id === 'kid')!
    expect(dadNode.top).toBe(momNode.top)
    expect(kidNode.top).toBeGreaterThan(dadNode.top)
    expect(result.couples[0].memberIds).toEqual(['dad', 'mom'])
  })

  it('keeps siblings contiguous and ordered by birth date', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const older = member('older', { birthDate: '2000-01-01' })
    const younger = member('younger', { birthDate: '2005-01-01' })
    linkSpouse(dad, mom)
    for (const child of [younger, older]) {
      linkParent(child, dad)
      linkParent(child, mom)
    }

    const result = await layoutGridFamilyTree(data([dad, mom, younger, older]))

    expect(result.nodes
      .filter((node) => ['older', 'younger'].includes(node.id))
      .sort((left, right) => left.cx - right.cx)
      .map((node) => node.id),
    ).toEqual(['older', 'younger'])
  })

  it('emits grid metadata for slot-aware dragging', async () => {
    const a = member('a')
    const b = member('b')

    const result = await layoutGridFamilyTree(data([a, b], {
      gridLayoutOverrides: { 'person:b': { order: -1 } },
    }))

    expect(result.grid?.memberSlotIds).toEqual({
      a: 'person:a',
      b: 'person:b',
    })
    expect(result.grid?.slotPositions['person:b'].order).toBe(0)
    expect(result.grid?.columnWidth).toBeGreaterThan(0)
  })

  it('ignores legacy manualPositions', async () => {
    const a = member('a')

    const result = await layoutGridFamilyTree(data([a], {
      manualPositions: { a: { cx: 100, top: 100 } },
    }))

    expect(result.nodes[0].cx).not.toBe(100 + result.offsetX)
    expect(result.nodes[0].top).toBe(0)
  })
})
```

- [ ] **Step 2: Run grid layout tests and verify failure**

Run:

```bash
npm.cmd test -- src/core/layout/gridFamilyLayout.test.ts
```

Expected: fails because `gridFamilyLayout.ts` and grid metadata type do not exist.

- [ ] **Step 3: Extend `LayoutResult` metadata**

In `src/core/elkLayout.ts`, add before `export interface LayoutResult`:

```ts
export interface GridLayoutMetadata {
  memberSlotIds: Record<string, string>
  slotPositions: Record<string, { generation: number; order: number; cx: number }>
  columnWidth: number
}
```

Add this field to `LayoutResult`:

```ts
  grid?: GridLayoutMetadata
```

- [ ] **Step 4: Implement grid layout engine**

Create `src/core/layout/gridFamilyLayout.ts`:

```ts
import type { FamilyData } from '@/core/schema'
import type { Couple, LaidOutNode, LayoutConnector, LayoutResult } from '../elkLayout'
import { buildGridFamilyModel, type GridSlot } from './gridFamilyModel'

const NODE_W = 2
const NODE_H = 4
const SPOUSE_GAP = 0.2
const ROW_HEIGHT = 7
const COLUMN_WIDTH = 3.5
const MEMBER_STEP = NODE_W + SPOUSE_GAP
const PADDING_COLUMNS = 0

export async function layoutGridFamilyTree(data: FamilyData): Promise<LayoutResult> {
  const model = buildGridFamilyModel(data)
  if (model.members.length === 0) {
    return {
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
      grid: { memberSlotIds: {}, slotPositions: {}, columnWidth: COLUMN_WIDTH },
    }
  }

  const slotById = new Map(model.slots.map((slot) => [slot.id, slot]))
  const nodes: LaidOutNode[] = []
  const slotPositions: Record<string, { generation: number; order: number; cx: number }> = {}

  for (const row of model.rows) {
    row.slotIds.forEach((slotId, order) => {
      const slot = slotById.get(slotId)
      if (!slot) return
      const cx = PADDING_COLUMNS + order * COLUMN_WIDTH + slotWidth(slot) / 2
      slotPositions[slot.id] = { generation: row.generation, order, cx }
      pushSlotNodes(nodes, slot, cx)
    })
  }

  const bounds = measureNodes(nodes)
  const offsetX = -bounds.minX
  for (const node of nodes) node.cx += offsetX
  for (const position of Object.values(slotPositions)) position.cx += offsetX

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const couples = buildCouples(model.slots, nodeById)
  const connectors = buildConnectors(model.childGroups, nodeById, slotPositions)
  const shiftedBounds = measureNodes(nodes)

  return {
    nodes: nodes.sort(compareNodes),
    couples,
    connectors,
    canvas: {
      width: shiftedBounds.maxX - shiftedBounds.minX,
      height: shiftedBounds.maxY,
    },
    orphanIds: [],
    offsetX,
    grid: {
      memberSlotIds: model.memberSlotIds,
      slotPositions,
      columnWidth: COLUMN_WIDTH,
    },
  }
}

function pushSlotNodes(nodes: LaidOutNode[], slot: GridSlot, slotCx: number) {
  const left = slotCx - slotWidth(slot) / 2
  for (const [index, id] of slot.memberIds.entries()) {
    nodes.push({
      id,
      cx: left + NODE_W / 2 + index * MEMBER_STEP,
      top: slot.generation * ROW_HEIGHT,
      generation: slot.generation,
    })
  }
}

function buildCouples(slots: GridSlot[], nodeById: Map<string, LaidOutNode>): Couple[] {
  return slots
    .filter((slot) => slot.kind === 'couple')
    .map((slot) => {
      const memberNodes = slot.memberIds
        .map((id) => nodeById.get(id))
        .filter((node): node is LaidOutNode => Boolean(node))
      return {
        id: slot.id,
        memberIds: slot.memberIds,
        generation: slot.generation,
        cx: average(memberNodes.map((node) => node.cx)),
      }
    })
    .sort((left, right) => left.generation - right.generation || left.cx - right.cx || left.id.localeCompare(right.id))
}

function buildConnectors(
  childGroups: Array<{ parentSlotId: string; childIds: string[] }>,
  nodeById: Map<string, LaidOutNode>,
  slotPositions: Record<string, { cx: number }>,
): LayoutConnector[] {
  const connectors: LayoutConnector[] = []

  for (const group of childGroups) {
    const parent = slotPositions[group.parentSlotId]
    const childNodes = group.childIds
      .map((id) => nodeById.get(id))
      .filter((node): node is LaidOutNode => Boolean(node))
    if (!parent || childNodes.length === 0) continue

    const parentY = Math.min(...childNodes.map((node) => node.top)) - (ROW_HEIGHT - NODE_H) / 2
    const childTop = Math.min(...childNodes.map((node) => node.top))
    const midY = (parentY + childTop) / 2
    connectors.push({
      kind: 'parent-child',
      points: [
        { x: parent.cx, y: parentY },
        { x: parent.cx, y: midY },
      ],
    })

    const childXs = childNodes.map((node) => node.cx)
    const minChildX = Math.min(...childXs)
    const maxChildX = Math.max(...childXs)
    if (childNodes.length > 1) {
      connectors.push({
        kind: 'parent-child',
        points: [
          { x: minChildX, y: midY },
          { x: maxChildX, y: midY },
        ],
      })
    }

    for (const child of childNodes) {
      connectors.push({
        kind: 'parent-child',
        points: [
          { x: child.cx, y: midY },
          { x: child.cx, y: child.top },
        ],
      })
    }
  }

  return connectors
}

function slotWidth(slot: GridSlot): number {
  return slot.memberIds.length * NODE_W + Math.max(0, slot.memberIds.length - 1) * SPOUSE_GAP
}

function measureNodes(nodes: LaidOutNode[]) {
  if (nodes.length === 0) return { minX: 0, maxX: 0, maxY: 0 }
  return {
    minX: Math.min(...nodes.map((node) => node.cx - NODE_W / 2)),
    maxX: Math.max(...nodes.map((node) => node.cx + NODE_W / 2)),
    maxY: Math.max(...nodes.map((node) => node.top + NODE_H)),
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function compareNodes(left: LaidOutNode, right: LaidOutNode): number {
  return left.generation - right.generation || left.cx - right.cx || left.id.localeCompare(right.id)
}
```

- [ ] **Step 5: Run grid layout tests**

Run:

```bash
npm.cmd test -- src/core/layout/gridFamilyLayout.test.ts
```

Expected: all grid layout tests pass.

- [ ] **Step 6: Commit grid layout engine**

```bash
git add src/core/elkLayout.ts src/core/layout/gridFamilyLayout.ts src/core/layout/gridFamilyLayout.test.ts
git commit -m "feat: add grid family layout engine"
```

---

### Task 5: Switch Default Layout Facade

**Files:**
- Modify: `src/core/treeLayout.ts`
- Modify: `src/core/treeLayout.test.ts`

- [ ] **Step 1: Update facade tests for grid data input**

In `src/core/treeLayout.test.ts`, add a test under the basic correctness describe block:

```ts
it('默认布局使用网格语义：当前夫妻成组，子女挂到主归属家庭', async () => {
  const list = [
    mk('dad', 'male', [], ['kid'], ['mom']),
    mk('mom', 'female', [], ['kid'], ['dad']),
    mk('kid', 'male', ['dad', 'mom'], [], []),
  ]
  const r = await layoutFamilyTree(list, {
    childLayoutAssignments: {
      kid: { primaryParentId: 'dad', primarySpouseId: 'mom' },
    },
    gridLayoutOverrides: {},
  })
  const dad = r.nodes.find((n) => n.id === 'dad')!
  const mom = r.nodes.find((n) => n.id === 'mom')!
  const kid = r.nodes.find((n) => n.id === 'kid')!

  expect(dad.top).toBe(mom.top)
  expect(kid.top).toBeGreaterThan(dad.top)
  expect(r.grid?.memberSlotIds.dad).toBe('couple:dad+mom')
})
```

- [ ] **Step 2: Run facade test and verify failure**

Run:

```bash
npm.cmd test -- src/core/treeLayout.test.ts
```

Expected: fails until `layoutFamilyTree` accepts V2 layout options and delegates to the grid engine.

- [ ] **Step 3: Switch facade to grid engine**

Replace `src/core/treeLayout.ts` with:

```ts
import type { ChildLayoutAssignments, GridLayoutOverrides, ManualPositions, Member } from './schema'
import { createEmptyFamily, type FamilyData } from './schema'
import type { LayoutResult } from './elkLayout'
import { layoutGridFamilyTree } from './layout/gridFamilyLayout'

export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

export interface LayoutFamilyTreeOptions {
  manualPositions?: ManualPositions
  childLayoutAssignments?: ChildLayoutAssignments
  gridLayoutOverrides?: GridLayoutOverrides
}

export async function layoutFamilyTree(
  members: Member[],
  opts: LayoutFamilyTreeOptions = {},
): Promise<LayoutResult> {
  const familyData: FamilyData = {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map((member) => [member.id, member])),
    manualPositions: opts.manualPositions ?? {},
    childLayoutAssignments: opts.childLayoutAssignments ?? {},
    gridLayoutOverrides: opts.gridLayoutOverrides ?? {},
  }
  return layoutGridFamilyTree(familyData)
}
```

- [ ] **Step 4: Update old tests that assumed manual positions affect default layout**

In `src/core/treeLayout.test.ts`, replace the manual position assertion test with:

```ts
it('manualPositions 在网格布局中仅作为旧数据保留，不影响节点坐标', async () => {
  const members = simpleFamily()
  const baseline = await layoutFamilyTree(members)
  const r = await layoutFamilyTree(members, {
    manualPositions: { kid: { cx: 50, top: 50 } },
  })
  const kidBase = baseline.nodes.find((n) => n.id === 'kid')!
  const kidOver = r.nodes.find((n) => n.id === 'kid')!
  expect(kidOver.cx).toBeCloseTo(kidBase.cx, 6)
  expect(kidOver.top).toBeCloseTo(kidBase.top, 6)
})
```

- [ ] **Step 5: Run facade tests**

Run:

```bash
npm.cmd test -- src/core/treeLayout.test.ts src/core/layout/gridFamilyLayout.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit facade switch**

```bash
git add src/core/treeLayout.ts src/core/treeLayout.test.ts
git commit -m "feat: use grid layout as default tree layout"
```

---

### Task 6: Persist Grid Slot Order From Canvas Dragging

**Files:**
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

- [ ] **Step 1: Update failing component tests**

In `src/__tests__/components/FamilyCanvas.test.ts`, change `defaultLayout` to include grid metadata:

```ts
  grid: {
    memberSlotIds: { A: 'person:A', B: 'person:B' },
    slotPositions: {
      'person:A': { generation: 0, order: 0, cx: 2 },
      'person:B': { generation: 1, order: 0, cx: 2 },
    },
    columnWidth: 3.5,
  },
```

Replace the `persists manual positions on node drop` test with:

```ts
  it('persists grid slot order on node drop', async () => {
    const members = makeFamily(['A'])
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    family.$patch((state) => {
      state.data.members = { A: members[0] }
    })

    const wrapper = mount(FamilyCanvas, {
      props: { members },
      global: {
        plugins: [pinia],
        stubs: { PanZoomWrapper: PanZoomStub },
      },
    })
    await nextTick()
    await nextTick()

    const node = wrapper.findComponent({ name: 'MemberNode' })
    await node.vm.$emit('drop', { id: 'A', dx: 220, dy: 55 })

    expect(family.data.gridLayoutOverrides['person:A']).toEqual({ order: 1 })
    expect(family.data.manualPositions.A).toBeUndefined()
  })
```

- [ ] **Step 2: Run component test and verify failure**

Run:

```bash
npm.cmd test -- src/__tests__/components/FamilyCanvas.test.ts
```

Expected: fails because `FamilyCanvas` still calls `setManualPosition`.

- [ ] **Step 3: Pass grid options into layout**

In `FamilyCanvas.vue`, extend props:

```ts
  childLayoutAssignments?: Record<string, { primaryParentId?: string; primarySpouseId?: string }>
  gridLayoutOverrides?: Record<string, { order: number }>
```

Update `updateLayout()`:

```ts
  const nextLayout = await layoutFamilyTree(props.members, {
    manualPositions: props.manualPositions,
    childLayoutAssignments: props.childLayoutAssignments,
    gridLayoutOverrides: props.gridLayoutOverrides,
  })
```

Update the watcher:

```ts
watch(
  () => [props.members, props.manualPositions, props.childLayoutAssignments, props.gridLayoutOverrides],
  updateLayout,
  { immediate: true, deep: true },
)
```

- [ ] **Step 4: Replace drop persistence**

In `FamilyCanvas.vue`, replace `onNodeDrop` with:

```ts
function onNodeDrop(payload: { id: string; dx: number; dy: number }) {
  const scale = screenToStageScale()
  delete dragDelta[payload.id]

  const slotId = layout.value.grid?.memberSlotIds[payload.id]
  if (!slotId) return
  const slotPosition = layout.value.grid?.slotPositions[slotId]
  const columnWidth = layout.value.grid?.columnWidth
  if (!slotPosition || !columnWidth) return

  const stageDxCells = payload.dx / scale / CELL_PX
  const deltaOrder = Math.round(stageDxCells / columnWidth)
  family.setGridLayoutOverride(slotId, {
    order: slotPosition.order + deltaOrder,
  })
}
```

- [ ] **Step 5: Update `TreeView.vue` canvas props**

Find the `FamilyCanvas` usage in `src/pages/TreeView.vue` and pass:

```vue
:child-layout-assignments="family.data.childLayoutAssignments"
:grid-layout-overrides="family.data.gridLayoutOverrides"
```

- [ ] **Step 6: Run component tests**

Run:

```bash
npm.cmd test -- src/__tests__/components/FamilyCanvas.test.ts
npm.cmd run typecheck
```

Expected: tests pass; typecheck exits 0.

- [ ] **Step 7: Commit canvas drag behavior**

```bash
git add src/components/tree/FamilyCanvas.vue src/pages/TreeView.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: snap canvas drag to grid slots"
```

---

### Task 7: Add Relation Editor Controls

**Files:**
- Modify: `src/components/member/RelationEditor.vue`
- Create: `src/__tests__/components/RelationEditor.test.ts`

- [ ] **Step 1: Write failing relation editor tests**

Create `src/__tests__/components/RelationEditor.test.ts`:

```ts
/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RelationEditor from '@/components/member/RelationEditor.vue'
import { useFamilyStore } from '@/stores/family'
import { mk, addParent } from '@/__tests__/fixtures/families'

describe('RelationEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores child primary layout assignment', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const child = mk('child')
    const parent = mk('parent')
    addParent(child, parent)
    family.$patch((state) => {
      state.data.members = { child, parent }
    })

    const wrapper = mount(RelationEditor, {
      props: { memberId: 'child' },
      global: { plugins: [pinia] },
    })

    const select = wrapper.find('[data-testid="child-layout-assignment"]')
    await select.setValue('parent')

    expect(family.data.childLayoutAssignments.child).toEqual({
      primaryParentId: 'parent',
    })
  })

  it('confirms before replacing a current spouse', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const family = useFamilyStore()
    const a = mk('a')
    const b = mk('b')
    const c = mk('c')
    family.$patch((state) => {
      state.data.members = { a, b, c }
    })
    family.linkCurrentSpouse('a', 'b', { replaceConflicts: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(RelationEditor, {
      props: { memberId: 'a' },
      global: { plugins: [pinia] },
    })

    await wrapper.find('select').setValue('spouse')
    const selects = wrapper.findAll('select')
    await selects[1].setValue('c')
    await wrapper.find('button:not([disabled])').trigger('click')

    expect(window.confirm).toHaveBeenCalled()
    expect(family.data.members.a.spouses).toEqual([{ id: 'c', type: 'married' }])
  })
})
```

- [ ] **Step 2: Run relation editor tests and verify failure**

Run:

```bash
npm.cmd test -- src/__tests__/components/RelationEditor.test.ts
```

Expected: fails because the UI and conflict flow are missing.

- [ ] **Step 3: Add child assignment computed state**

In `RelationEditor.vue`, add:

```ts
const childLayoutValue = computed({
  get() {
    const assignment = family.data.childLayoutAssignments[props.memberId]
    if (!assignment?.primaryParentId) return ''
    return assignment.primarySpouseId
      ? `${assignment.primaryParentId}+${assignment.primarySpouseId}`
      : assignment.primaryParentId
  },
  set(value: string) {
    if (!value) {
      family.setChildLayoutAssignment(props.memberId, null)
      return
    }
    const [primaryParentId, primarySpouseId] = value.split('+')
    family.setChildLayoutAssignment(props.memberId, {
      primaryParentId,
      primarySpouseId,
    })
  },
})

const childLayoutOptions = computed(() => {
  const member = me.value
  if (!member) return []
  return member.parents
    .map((parent) => family.getMember(parent.id))
    .filter((parent): parent is Member => Boolean(parent))
    .flatMap((parent) => {
      const spouse = parent.spouses.find((ref) => ref.type === 'married')
      if (!spouse) return [{ value: parent.id, label: fullName(parent) }]
      const spouseMember = family.getMember(spouse.id)
      if (!spouseMember) return [{ value: parent.id, label: fullName(parent) }]
      return [
        { value: `${parent.id}+${spouse.id}`, label: `${fullName(parent)} + ${fullName(spouseMember)}` },
        { value: parent.id, label: fullName(parent) },
      ]
    })
})
```

- [ ] **Step 4: Update spouse add flow**

Replace `addRelation()` with:

```ts
function addRelation() {
  if (!addTargetId.value) return
  if (addKind.value === 'spouse') {
    const conflicts = family.getCurrentSpouseConflicts(props.memberId, addTargetId.value)
    if (conflicts.length > 0) {
      const names = conflicts
        .map((id) => family.getMember(id))
        .filter((member): member is Member => Boolean(member))
        .map(fullName)
        .join('、')
      const confirmed = window.confirm(`已有当前配偶：${names}。是否解除旧关系并建立新的当前配偶关系？`)
      if (!confirmed) return
    }
    family.linkCurrentSpouse(props.memberId, addTargetId.value, { replaceConflicts: true })
    addTargetId.value = ''
    return
  }
  family.linkRelation(props.memberId, addTargetId.value, addKind.value)
  addTargetId.value = ''
}
```

- [ ] **Step 5: Add child assignment select to template**

Add after the parent list block:

```vue
    <div v-if="parentsList.length > 0">
      <div class="mb-1 text-xs font-medium text-slate-500">主布局归属</div>
      <select
        v-model="childLayoutValue"
        data-testid="child-layout-assignment"
        class="w-full rounded border border-slate-300 px-2 py-1"
      >
        <option value="">自动</option>
        <option v-for="option in childLayoutOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
```

- [ ] **Step 6: Run relation editor tests**

Run:

```bash
npm.cmd test -- src/__tests__/components/RelationEditor.test.ts
npm.cmd run typecheck
```

Expected: tests pass; typecheck exits 0.

- [ ] **Step 7: Commit relation editor behavior**

```bash
git add src/components/member/RelationEditor.vue src/__tests__/components/RelationEditor.test.ts
git commit -m "feat: add grid relation controls"
```

---

### Task 8: Final Regression Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-02-grid-family-layout-design.md` if implementation diverged from the confirmed spec.

- [ ] **Step 1: Update README layout summary**

In `README.md`, update the layout description to state:

```md
- **家族树可视化** - 默认使用代际网格布局：每人最多一个当前配偶，子女挂到主布局归属家庭，拖拽严格吸附同代网格槽位；历史配偶和非主归属父母作为关系数据保留。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm.cmd test -- src/core/migrate.test.ts src/stores/family.test.ts src/core/layout/gridFamilyModel.test.ts src/core/layout/gridFamilyLayout.test.ts src/core/treeLayout.test.ts src/__tests__/components/FamilyCanvas.test.ts src/__tests__/components/RelationEditor.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Expected:

- `npm.cmd test`: all tests pass.
- `npm.cmd run typecheck`: exits 0.
- `npm.cmd run build`: exits 0. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 4: Commit documentation and final fixes**

```bash
git add README.md docs/superpowers/specs/2026-07-02-grid-family-layout-design.md
git commit -m "docs: document grid family layout behavior"
```

---

## Self-Review

Spec coverage:

- Current-spouse strong constraint: Tasks 1, 2, and 7.
- Child primary layout assignment: Tasks 1, 3, and 7.
- Grid row/slot model: Tasks 3 and 4.
- `LayoutResult` compatibility: Tasks 4 and 5.
- Drag/drop grid snapping: Task 6.
- Migration and legacy `manualPositions` compatibility: Tasks 1, 4, and 5.
- Testing and final verification: Task 8.

Placeholder scan:

- The plan uses concrete filenames, function names, test bodies, command lines, and expected results.
- No task depends on unspecified implementation details outside the listed files.

Type consistency:

- Schema fields are `childLayoutAssignments` and `gridLayoutOverrides`.
- Store methods are `getCurrentSpouseConflicts`, `linkCurrentSpouse`, `setChildLayoutAssignment`, and `setGridLayoutOverride`.
- Grid metadata is `LayoutResult.grid` with `memberSlotIds`, `slotPositions`, and `columnWidth`.

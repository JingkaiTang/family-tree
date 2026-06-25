# Constraint Family Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current free-form default family tree layout with a deterministic, family-unit based layout that treats spouses/parents/children as constrained groups.

**Architecture:** Build a semantic layout model first: people, union/family units, child groups, connected components, and stable ordering. Implement a new default layout engine beside the current ELK layout, verify it with focused fixtures, then switch `treeLayout.ts` to the new engine while keeping the old ELK engine available as a fallback during the transition.

**Tech Stack:** Vue 3 + TypeScript, Vitest, existing `Member` schema, existing `LayoutResult` shape, no new runtime layout dependency.

---

## Scope

This plan only changes the default family tree layout. It does not redesign the protagonist/center layout, kinship calculation, member editing, or toolbar UI. Center layout remains a separate mode.

Primary success criteria:

- Default layout is deterministic for the same `Member[]`.
- Parents are always above children.
- Spouses/parents are treated as a stable family unit.
- Siblings under the same parent union are contiguous.
- Independent components are separated predictably.
- Public API remains `layoutFamilyTree(members, opts?)`.
- Existing test commands pass: `npm test`, `npm run typecheck`, `npm run build`.

## File Structure

- Create `src/core/layout/familyGraphModel.ts`  
  Converts raw `Member[]` into people, parent unions, spouse-only unions, child groups, and connected components.

- Create `src/core/layout/familyGraphModel.test.ts`  
  Tests union construction, stable ids, single-parent groups, spouse-only groups, and component separation.

- Create `src/core/layout/constraintFamilyLayout.ts`  
  Computes deterministic coordinates and connectors from the semantic model.

- Create `src/core/layout/constraintFamilyLayout.test.ts`  
  Tests generation constraints, sibling continuity, no overlap, manual position behavior, component packing, and connector routing.

- Modify `src/core/treeLayout.ts`  
  Switches the public default layout facade from ELK to `layoutConstraintFamilyTree`.

- Modify `src/core/treeLayout.test.ts`  
  Updates tests to assert the new default layout invariants instead of ELK-specific behavior.

- Keep `src/core/elkLayout.ts` unchanged  
  It remains available for comparison or fallback until the new layout has visual confidence.

---

### Task 1: Create Semantic Family Graph Model

**Files:**
- Create: `src/core/layout/familyGraphModel.ts`
- Create: `src/core/layout/familyGraphModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/core/layout/familyGraphModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Member } from '@/core/schema'
import { buildFamilyGraphModel } from './familyGraphModel'

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

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

describe('buildFamilyGraphModel', () => {
  it('creates one parent union for a two-parent child group', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkParent(kid, dad)
    linkParent(kid, mom)
    linkSpouse(dad, mom)

    const model = buildFamilyGraphModel([dad, mom, kid])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'parents:dad+mom',
      partnerIds: ['dad', 'mom'],
      childIds: ['kid'],
    })
  })

  it('creates one single-parent union when a child has one known parent', () => {
    const mom = member('mom')
    const kid = member('kid')
    linkParent(kid, mom)

    const model = buildFamilyGraphModel([mom, kid])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'parents:mom',
      partnerIds: ['mom'],
      childIds: ['kid'],
    })
  })

  it('creates a spouse-only union when partners have no child group', () => {
    const a = member('a')
    const b = member('b')
    linkSpouse(a, b)

    const model = buildFamilyGraphModel([a, b])

    expect(model.unions).toHaveLength(1)
    expect(model.unions[0]).toMatchObject({
      id: 'spouse:a+b',
      partnerIds: ['a', 'b'],
      childIds: [],
    })
  })

  it('orders child ids by birth date then id', () => {
    const dad = member('dad')
    const older = member('older', { birthDate: '1990-01-01' })
    const younger = member('younger', { birthDate: '2000-01-01' })
    linkParent(younger, dad)
    linkParent(older, dad)

    const model = buildFamilyGraphModel([dad, younger, older])

    expect(model.unions[0].childIds).toEqual(['older', 'younger'])
  })

  it('separates disconnected components', () => {
    const a = member('a')
    const b = member('b')

    const model = buildFamilyGraphModel([a, b])

    expect(model.components.map(c => c.personIds)).toEqual([['a'], ['b']])
  })
})
```

- [ ] **Step 2: Run model test and verify it fails**

Run:

```bash
npm test -- src/core/layout/familyGraphModel.test.ts
```

Expected: fail because `src/core/layout/familyGraphModel.ts` does not exist.

- [ ] **Step 3: Implement semantic model**

Create `src/core/layout/familyGraphModel.ts`:

```ts
import type { Member } from '@/core/schema'

export interface FamilyPersonNode {
  id: string
  member: Member
}

export interface FamilyUnionNode {
  id: string
  partnerIds: string[]
  childIds: string[]
}

export interface FamilyComponent {
  id: string
  personIds: string[]
  unionIds: string[]
}

export interface FamilyGraphModel {
  people: FamilyPersonNode[]
  unions: FamilyUnionNode[]
  components: FamilyComponent[]
}

function stableMemberSort(a: Member, b: Member): number {
  const aDate = a.birthDate ?? ''
  const bDate = b.birthDate ?? ''
  if (aDate !== bDate) {
    if (!aDate) return 1
    if (!bDate) return -1
    return aDate.localeCompare(bDate)
  }
  return a.id.localeCompare(b.id)
}

function stableIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

function parentUnionId(parentIds: string[]): string {
  return `parents:${stableIds(parentIds).join('+')}`
}

function spouseUnionId(a: string, b: string): string {
  return `spouse:${stableIds([a, b]).join('+')}`
}

export function buildFamilyGraphModel(members: Member[]): FamilyGraphModel {
  const orderedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(orderedMembers.map(member => [member.id, member]))
  const unionById = new Map<string, FamilyUnionNode>()

  for (const child of orderedMembers) {
    const parentIds = stableIds(child.parents.map(parent => parent.id).filter(id => byId.has(id)))
    if (parentIds.length === 0) continue
    const id = parentUnionId(parentIds)
    const union = unionById.get(id) ?? { id, partnerIds: parentIds, childIds: [] }
    union.partnerIds = parentIds
    if (!union.childIds.includes(child.id)) union.childIds.push(child.id)
    unionById.set(id, union)
  }

  for (const union of unionById.values()) {
    union.childIds.sort((a, b) => stableMemberSort(byId.get(a)!, byId.get(b)!))
  }

  for (const member of orderedMembers) {
    for (const spouse of member.spouses) {
      if (!byId.has(spouse.id)) continue
      const id = spouseUnionId(member.id, spouse.id)
      if (unionById.has(id)) continue
      const partnerIds = stableIds([member.id, spouse.id])
      const hasParentUnion = [...unionById.values()].some(union =>
        partnerIds.every(pid => union.partnerIds.includes(pid)),
      )
      if (!hasParentUnion) {
        unionById.set(id, { id, partnerIds, childIds: [] })
      }
    }
  }

  const unions = [...unionById.values()].sort((a, b) => a.id.localeCompare(b.id))
  const components = buildComponents(orderedMembers, unions)

  return {
    people: orderedMembers.map(member => ({ id: member.id, member })),
    unions,
    components,
  }
}

function buildComponents(members: Member[], unions: FamilyUnionNode[]): FamilyComponent[] {
  const adjacent = new Map<string, Set<string>>()
  for (const member of members) adjacent.set(`person:${member.id}`, new Set())
  for (const union of unions) {
    const unionKey = `union:${union.id}`
    adjacent.set(unionKey, new Set())
    for (const personId of [...union.partnerIds, ...union.childIds]) {
      const personKey = `person:${personId}`
      adjacent.get(unionKey)!.add(personKey)
      adjacent.get(personKey)?.add(unionKey)
    }
  }

  const seen = new Set<string>()
  const components: FamilyComponent[] = []
  for (const key of [...adjacent.keys()].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(key)) continue
    const queue = [key]
    seen.add(key)
    const personIds: string[] = []
    const unionIds: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.startsWith('person:')) personIds.push(current.slice('person:'.length))
      if (current.startsWith('union:')) unionIds.push(current.slice('union:'.length))
      for (const next of adjacent.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    components.push({
      id: personIds[0] ?? unionIds[0],
      personIds: personIds.sort((a, b) => a.localeCompare(b)),
      unionIds: unionIds.sort((a, b) => a.localeCompare(b)),
    })
  }
  return components
}
```

- [ ] **Step 4: Run model tests and verify they pass**

Run:

```bash
npm test -- src/core/layout/familyGraphModel.test.ts
```

Expected: all tests in `familyGraphModel.test.ts` pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/layout/familyGraphModel.ts src/core/layout/familyGraphModel.test.ts
git commit -m "feat: add semantic family layout model"
```

---

### Task 2: Add Constraint Layout Engine Beside Existing ELK Layout

**Files:**
- Create: `src/core/layout/constraintFamilyLayout.ts`
- Create: `src/core/layout/constraintFamilyLayout.test.ts`

- [ ] **Step 1: Write failing layout tests**

Create `src/core/layout/constraintFamilyLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Member } from '@/core/schema'
import { layoutConstraintFamilyTree } from './constraintFamilyLayout'

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

function linkSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

function expectNoOverlap(nodes: Array<{ cx: number; top: number }>) {
  const width = 2
  const height = 4
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const overlap = !(
        a.cx + width / 2 <= b.cx - width / 2 ||
        b.cx + width / 2 <= a.cx - width / 2 ||
        a.top + height <= b.top ||
        b.top + height <= a.top
      )
      expect(overlap).toBe(false)
    }
  }
}

describe('layoutConstraintFamilyTree', () => {
  it('places parents above children', async () => {
    const dad = member('dad')
    const kid = member('kid')
    linkParent(kid, dad)

    const result = await layoutConstraintFamilyTree([dad, kid])
    const dadNode = result.nodes.find(n => n.id === 'dad')!
    const kidNode = result.nodes.find(n => n.id === 'kid')!

    expect(dadNode.top).toBeLessThan(kidNode.top)
  })

  it('keeps spouses on the same row with stable horizontal spacing', async () => {
    const dad = member('dad', { gender: 'male' })
    const mom = member('mom', { gender: 'female' })
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = await layoutConstraintFamilyTree([kid, mom, dad])
    const dadNode = result.nodes.find(n => n.id === 'dad')!
    const momNode = result.nodes.find(n => n.id === 'mom')!

    expect(dadNode.top).toBe(momNode.top)
    expect(Math.abs(dadNode.cx - momNode.cx)).toBeGreaterThanOrEqual(2)
    expect(Math.abs(dadNode.cx - momNode.cx)).toBeLessThan(3)
  })

  it('keeps siblings under the same parents contiguous', async () => {
    const dad = member('dad')
    const mom = member('mom')
    const a = member('a', { birthDate: '1990-01-01' })
    const b = member('b', { birthDate: '1995-01-01' })
    const c = member('c', { birthDate: '2000-01-01' })
    linkSpouse(dad, mom)
    for (const child of [c, a, b]) {
      linkParent(child, dad)
      linkParent(child, mom)
    }

    const result = await layoutConstraintFamilyTree([dad, mom, c, a, b])
    const childIds = result.nodes
      .filter(n => ['a', 'b', 'c'].includes(n.id))
      .sort((x, y) => x.cx - y.cx)
      .map(n => n.id)

    expect(childIds).toEqual(['a', 'b', 'c'])
  })

  it('does not overlap nodes in a three-generation family', async () => {
    const gpa = member('gpa')
    const gma = member('gma')
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(gpa, gma)
    linkSpouse(dad, mom)
    linkParent(dad, gpa)
    linkParent(dad, gma)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = await layoutConstraintFamilyTree([gpa, gma, dad, mom, kid])

    expectNoOverlap(result.nodes)
  })

  it('separates disconnected components horizontally', async () => {
    const a = member('a')
    const b = member('b')

    const result = await layoutConstraintFamilyTree([a, b])
    const aNode = result.nodes.find(n => n.id === 'a')!
    const bNode = result.nodes.find(n => n.id === 'b')!

    expect(Math.abs(aNode.cx - bNode.cx)).toBeGreaterThanOrEqual(3.5)
  })
})
```

- [ ] **Step 2: Run layout tests and verify they fail**

Run:

```bash
npm test -- src/core/layout/constraintFamilyLayout.test.ts
```

Expected: fail because `constraintFamilyLayout.ts` does not exist.

- [ ] **Step 3: Implement deterministic layout engine**

Create `src/core/layout/constraintFamilyLayout.ts`:

```ts
import type { Member } from '@/core/schema'
import type { LayoutConnector, LayoutResult } from '@/core/treeLayout'
import { buildFamilyGraphModel, type FamilyGraphModel, type FamilyUnionNode } from './familyGraphModel'

const NODE_W = 2
const NODE_H = 4
const SPOUSE_GAP = 0.2
const SIBLING_GAP = 1.5
const COMPONENT_GAP = 4
const ROW_HEIGHT = 7

interface PositionedPerson {
  id: string
  cx: number
  top: number
  generation: number
}

interface RowUnit {
  ids: string[]
  anchorUnionId?: string
  width: number
}

export async function layoutConstraintFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
): Promise<LayoutResult> {
  if (members.length === 0) {
    return { nodes: [], couples: [], connectors: [], canvas: { width: 0, height: 0 }, orphanIds: [], offsetX: 0 }
  }

  const model = buildFamilyGraphModel(members)
  const generations = assignGenerations(model)
  const nodes: PositionedPerson[] = []
  let componentOffset = 0

  for (const component of model.components) {
    const componentNodes = layoutComponent(model, component.personIds, component.unionIds, generations)
    const minX = Math.min(...componentNodes.map(n => n.cx - NODE_W / 2))
    const maxX = Math.max(...componentNodes.map(n => n.cx + NODE_W / 2))
    for (const node of componentNodes) {
      nodes.push({ ...node, cx: node.cx - minX + componentOffset })
    }
    componentOffset += (maxX - minX) + COMPONENT_GAP
  }

  for (const node of nodes) {
    const manual = opts?.manualPositions?.[node.id]
    if (manual) {
      node.cx = manual.cx
      node.top = manual.top
    }
  }

  const minX = Math.min(...nodes.map(n => n.cx - NODE_W / 2))
  const maxX = Math.max(...nodes.map(n => n.cx + NODE_W / 2))
  const maxY = Math.max(...nodes.map(n => n.top + NODE_H))
  const dx = -minX
  for (const node of nodes) node.cx += dx

  const couples = model.unions
    .filter(union => union.partnerIds.length > 0)
    .map(union => ({
      id: union.id,
      memberIds: union.partnerIds,
      generation: Math.min(...union.partnerIds.map(id => generations.get(id) ?? 0)),
      cx: average(union.partnerIds.map(id => nodes.find(n => n.id === id)?.cx).filter((x): x is number => x !== undefined)),
    }))

  const connectors = buildConnectors(model, nodes)

  return {
    nodes,
    couples,
    connectors,
    canvas: { width: maxX - minX, height: maxY },
    orphanIds: [],
    offsetX: dx,
  }
}

function assignGenerations(model: FamilyGraphModel): Map<string, number> {
  const generations = new Map<string, number>()
  for (const person of model.people) {
    const hasKnownParent = person.member.parents.some(parent => model.people.some(p => p.id === parent.id))
    if (!hasKnownParent) generations.set(person.id, 0)
  }

  let changed = true
  for (let pass = 0; pass < model.people.length && changed; pass++) {
    changed = false
    for (const union of model.unions) {
      const knownPartnerGens = union.partnerIds
        .map(id => generations.get(id))
        .filter((gen): gen is number => gen !== undefined)
      if (knownPartnerGens.length > 0) {
        const partnerGen = Math.min(...knownPartnerGens)
        for (const partnerId of union.partnerIds) {
          if (generations.get(partnerId) !== partnerGen) {
            generations.set(partnerId, partnerGen)
            changed = true
          }
        }
        for (const childId of union.childIds) {
          const childGen = partnerGen + 1
          if ((generations.get(childId) ?? -Infinity) < childGen) {
            generations.set(childId, childGen)
            changed = true
          }
        }
      }
    }
  }

  for (const person of model.people) {
    if (!generations.has(person.id)) generations.set(person.id, 0)
  }

  const min = Math.min(...generations.values())
  for (const [id, gen] of generations) generations.set(id, gen - min)
  return generations
}

function layoutComponent(
  model: FamilyGraphModel,
  personIds: string[],
  unionIds: string[],
  generations: Map<string, number>,
): PositionedPerson[] {
  const unions = unionIds
    .map(id => model.unions.find(union => union.id === id))
    .filter((union): union is FamilyUnionNode => !!union)
  const byGeneration = new Map<number, RowUnit[]>()
  const assigned = new Set<string>()

  for (const union of unions) {
    const partnerGen = Math.min(...union.partnerIds.map(id => generations.get(id) ?? 0))
    addRowUnit(byGeneration, partnerGen, {
      ids: union.partnerIds,
      anchorUnionId: union.id,
      width: unitWidth(union.partnerIds.length),
    })
    for (const id of union.partnerIds) assigned.add(id)
  }

  for (const id of personIds) {
    if (assigned.has(id)) continue
    addRowUnit(byGeneration, generations.get(id) ?? 0, {
      ids: [id],
      width: unitWidth(1),
    })
  }

  const nodes: PositionedPerson[] = []
  for (const [generation, units] of [...byGeneration.entries()].sort(([a], [b]) => a - b)) {
    const ordered = [...units].sort((a, b) => rowUnitSortKey(a).localeCompare(rowUnitSortKey(b)))
    let cursor = 0
    for (const unit of ordered) {
      placeUnit(nodes, unit, cursor, generation)
      cursor += unit.width + SIBLING_GAP
    }
  }

  centerChildGroups(nodes, unions, generations)
  repackRows(nodes)
  return nodes
}

function addRowUnit(map: Map<number, RowUnit[]>, generation: number, unit: RowUnit) {
  if (!map.has(generation)) map.set(generation, [])
  map.get(generation)!.push(unit)
}

function unitWidth(count: number): number {
  return count * NODE_W + Math.max(0, count - 1) * SPOUSE_GAP
}

function placeUnit(nodes: PositionedPerson[], unit: RowUnit, left: number, generation: number) {
  unit.ids.forEach((id, index) => {
    nodes.push({
      id,
      cx: left + NODE_W / 2 + index * (NODE_W + SPOUSE_GAP),
      top: generation * ROW_HEIGHT,
      generation,
    })
  })
}

function rowUnitSortKey(unit: RowUnit): string {
  return unit.anchorUnionId ?? unit.ids.join('+')
}

function centerChildGroups(nodes: PositionedPerson[], unions: FamilyUnionNode[], generations: Map<string, number>) {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  for (const union of unions) {
    if (union.childIds.length === 0) continue
    const parentNodes = union.partnerIds.map(id => nodeById.get(id)).filter((node): node is PositionedPerson => !!node)
    const childNodes = union.childIds.map(id => nodeById.get(id)).filter((node): node is PositionedPerson => !!node)
    if (parentNodes.length === 0 || childNodes.length === 0) continue
    const parentCenter = average(parentNodes.map(node => node.cx))
    const childCenter = average(childNodes.map(node => node.cx))
    const delta = parentCenter - childCenter
    for (const child of childNodes) child.cx += delta
    for (const childId of union.childIds) {
      const gen = generations.get(childId)
      if (gen !== undefined) nodeById.get(childId)!.generation = gen
    }
  }
}

function repackRows(nodes: PositionedPerson[]) {
  const byTop = new Map<number, PositionedPerson[]>()
  for (const node of nodes) {
    if (!byTop.has(node.top)) byTop.set(node.top, [])
    byTop.get(node.top)!.push(node)
  }
  for (const row of byTop.values()) {
    const ordered = [...row].sort((a, b) => a.cx - b.cx || a.id.localeCompare(b.id))
    let cursor: number | null = null
    for (const node of ordered) {
      const left = node.cx - NODE_W / 2
      if (cursor !== null && left < cursor + SIBLING_GAP) {
        node.cx += cursor + SIBLING_GAP - left
      }
      cursor = node.cx + NODE_W / 2
    }
  }
}

function buildConnectors(model: FamilyGraphModel, nodes: PositionedPerson[]): LayoutConnector[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const connectors: LayoutConnector[] = []

  for (const union of model.unions) {
    const partnerNodes = union.partnerIds.map(id => nodeById.get(id)).filter((node): node is PositionedPerson => !!node)
    if (partnerNodes.length === 2) {
      connectors.push({
        kind: 'spouse',
        points: [
          { x: partnerNodes[0].cx, y: partnerNodes[0].top + NODE_H / 2 },
          { x: partnerNodes[1].cx, y: partnerNodes[1].top + NODE_H / 2 },
        ],
      })
    }

    if (partnerNodes.length === 0 || union.childIds.length === 0) continue
    const parentX = average(partnerNodes.map(node => node.cx))
    const parentY = Math.max(...partnerNodes.map(node => node.top + NODE_H))
    const childNodes = union.childIds.map(id => nodeById.get(id)).filter((node): node is PositionedPerson => !!node)
    if (childNodes.length === 0) continue
    const midY = (parentY + Math.min(...childNodes.map(node => node.top))) / 2
    connectors.push({ kind: 'parent-child', points: [{ x: parentX, y: parentY }, { x: parentX, y: midY }] })
    if (childNodes.length > 1) {
      connectors.push({
        kind: 'parent-child',
        points: [
          { x: Math.min(...childNodes.map(node => node.cx)), y: midY },
          { x: Math.max(...childNodes.map(node => node.cx)), y: midY },
        ],
      })
    }
    for (const child of childNodes) {
      connectors.push({ kind: 'parent-child', points: [{ x: child.cx, y: midY }, { x: child.cx, y: child.top }] })
    }
  }

  return connectors
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
```

- [ ] **Step 4: Run layout tests and verify they pass**

Run:

```bash
npm test -- src/core/layout/constraintFamilyLayout.test.ts
```

Expected: all tests in `constraintFamilyLayout.test.ts` pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/layout/constraintFamilyLayout.ts src/core/layout/constraintFamilyLayout.test.ts
git commit -m "feat: add deterministic family layout engine"
```

---

### Task 3: Switch Public Default Layout Facade

**Files:**
- Modify: `src/core/treeLayout.ts`
- Modify: `src/core/treeLayout.test.ts`

- [ ] **Step 1: Write failing facade test**

Add this case to `src/core/treeLayout.test.ts` under the default layout describe block:

```ts
it('默认布局使用强约束家庭单元：同父母子女连续且父母居中', async () => {
  const list = [
    mk('dad', 'male', [], ['a', 'b', 'c'], ['mom']),
    mk('mom', 'female', [], ['a', 'b', 'c'], ['dad']),
    mk('a', 'male', ['dad', 'mom'], [], []),
    mk('b', 'female', ['dad', 'mom'], [], []),
    mk('c', 'male', ['dad', 'mom'], [], []),
  ]
  const r = await layoutFamilyTree(list)
  const dad = r.nodes.find(n => n.id === 'dad')!
  const mom = r.nodes.find(n => n.id === 'mom')!
  const children = r.nodes
    .filter(n => ['a', 'b', 'c'].includes(n.id))
    .sort((x, y) => x.cx - y.cx)

  expect(dad.top).toBe(mom.top)
  expect(children.map(n => n.id)).toEqual(['a', 'b', 'c'])
  expect(children.every(child => child.top > dad.top)).toBe(true)
  expect((children[0].cx + children[2].cx) / 2).toBeCloseTo((dad.cx + mom.cx) / 2, 6)
})
```

- [ ] **Step 2: Run facade test and verify it fails or still uses ELK-specific behavior**

Run:

```bash
npm test -- src/core/treeLayout.test.ts
```

Expected before switching: the new assertion can fail if ELK ordering or centering differs.

- [ ] **Step 3: Switch `treeLayout.ts` to the new engine**

Replace `src/core/treeLayout.ts` with:

```ts
import type { Member } from './schema'
import type { LayoutResult } from './elkLayout'
import { layoutConstraintFamilyTree } from './layout/constraintFamilyLayout'

export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

export async function layoutFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
): Promise<LayoutResult> {
  return layoutConstraintFamilyTree(members, opts)
}
```

- [ ] **Step 4: Run facade tests and update only assertions that describe old ELK behavior**

Run:

```bash
npm test -- src/core/treeLayout.test.ts
```

Expected: tests pass after updating assertions to the new invariants. Keep assertions for no overlap, parent above child, spouse same row, manual positions, and connectors.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/treeLayout.ts src/core/treeLayout.test.ts
git commit -m "feat: use constraint layout as default family tree layout"
```

---

### Task 4: Preserve Manual Position Behavior for Default Layout

**Files:**
- Modify: `src/core/layout/constraintFamilyLayout.test.ts`
- Modify: `src/core/layout/constraintFamilyLayout.ts`

- [ ] **Step 1: Add failing manual-position regression test**

Add this test to `src/core/layout/constraintFamilyLayout.test.ts`:

```ts
it('manualPositions override default coordinates and connector endpoints follow', async () => {
  const dad = member('dad')
  const kid = member('kid')
  linkParent(kid, dad)

  const result = await layoutConstraintFamilyTree([dad, kid], {
    manualPositions: { kid: { cx: 20, top: 30 } },
  })
  const kidNode = result.nodes.find(n => n.id === 'kid')!

  expect(kidNode.cx).toBeCloseTo(20 + result.offsetX, 6)
  expect(kidNode.top).toBeCloseTo(30, 6)
  expect(result.connectors.some(connector =>
    connector.kind === 'parent-child' &&
    connector.points.some(point => Math.abs(point.x - kidNode.cx) < 1e-6 && Math.abs(point.y - kidNode.top) < 1e-6),
  )).toBe(true)
})
```

- [ ] **Step 2: Run test and verify current behavior**

Run:

```bash
npm test -- src/core/layout/constraintFamilyLayout.test.ts
```

Expected: if it fails, it fails because manual override is applied before `offsetX` or connectors are built from stale coordinates.

- [ ] **Step 3: Adjust manual override order**

In `src/core/layout/constraintFamilyLayout.ts`, keep manual coordinate overrides before final `minX/dx` normalization and build connectors after normalization. The function should follow this order:

```ts
// 1. build model
// 2. layout generated coordinates
// 3. apply manual positions in raw cell coordinates
// 4. calculate minX/maxX/maxY
// 5. add offsetX to every node
// 6. build couples/connectors from final node coordinates
```

- [ ] **Step 4: Run manual-position test**

Run:

```bash
npm test -- src/core/layout/constraintFamilyLayout.test.ts --testNamePattern manualPositions
```

Expected: manual-position regression passes.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/layout/constraintFamilyLayout.ts src/core/layout/constraintFamilyLayout.test.ts
git commit -m "fix: preserve manual positions in constraint layout"
```

---

### Task 5: Add Realistic Layout Regression Fixtures

**Files:**
- Modify: `src/__tests__/e2e/scenarios/layout-verification.test.ts`
- Modify: `src/__tests__/fixtures/families.ts`

- [ ] **Step 1: Add fixture for multi-spouse and independent components**

Append to `src/__tests__/fixtures/families.ts`:

```ts
export function multiUnionFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    parentA: mk('parentA', { gender: 'male' }),
    parentB: mk('parentB', { gender: 'female' }),
    parentC: mk('parentC', { gender: 'female' }),
    childAB1: mk('childAB1', { gender: 'male', birthDate: '2000-01-01' }),
    childAB2: mk('childAB2', { gender: 'female', birthDate: '2002-01-01' }),
    childAC: mk('childAC', { gender: 'male', birthDate: '2010-01-01' }),
    stranger: mk('stranger', { gender: 'other' }),
  }
  addSpouse(m.parentA, m.parentB)
  addSpouse(m.parentA, m.parentC)
  addParent(m.childAB1, m.parentA)
  addParent(m.childAB1, m.parentB)
  addParent(m.childAB2, m.parentA)
  addParent(m.childAB2, m.parentB)
  addParent(m.childAC, m.parentA)
  addParent(m.childAC, m.parentC)
  return m
}
```

- [ ] **Step 2: Add L3 layout assertions**

Add tests to `src/__tests__/e2e/scenarios/layout-verification.test.ts`:

```ts
import { multiUnionFamily } from '@/__tests__/fixtures/families'
import { layoutFamilyTree } from '@/core/treeLayout'
```

```ts
it('多组亲子 union 下，各组子女保持连续', async () => {
  const r = await layoutFamilyTree(Object.values(multiUnionFamily()))
  const abChildren = r.nodes
    .filter(n => ['childAB1', 'childAB2'].includes(n.id))
    .sort((a, b) => a.cx - b.cx)
  expect(abChildren.map(n => n.id)).toEqual(['childAB1', 'childAB2'])
})

it('多组件成员不会和主家庭重叠', async () => {
  const r = await layoutFamilyTree(Object.values(multiUnionFamily()))
  expect(nonOverlapping(r.nodes)).toBe(true)
})
```

- [ ] **Step 3: Run L3 layout tests**

Run:

```bash
npm test -- src/__tests__/e2e/scenarios/layout-verification.test.ts
```

Expected: L3 layout tests pass using the public default layout path after Task 3 has switched the facade.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/__tests__/fixtures/families.ts src/__tests__/e2e/scenarios/layout-verification.test.ts
git commit -m "test: cover multi-union family layout scenarios"
```

---

### Task 6: Keep Center Layout Separate from Default Manual Layout

**Files:**
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

- [ ] **Step 1: Add failing component test for center-layout drops**

Add to `src/__tests__/components/FamilyCanvas.test.ts`:

```ts
it('center layout does not persist manual positions on node drop', async () => {
  const members = makeFamily(['A'])
  const family = useFamilyStore()
  family.$patch((state) => {
    state.data.members = { A: members[0] }
  })

  const wrapper = mount(FamilyCanvas, {
    props: { members, centerLayoutId: 'A' },
    global: {
      plugins: [createPinia()],
      stubs: { PanZoomWrapper: PanZoomStub },
    },
  })
  await nextTick()
  await nextTick()

  const node = wrapper.findComponent({ name: 'MemberNode' })
  await node.vm.$emit('drop', { id: 'A', dx: 10, dy: 10 })

  expect(family.data.manualPositions.A).toBeUndefined()
})
```

Also add imports at the top if missing:

```ts
import { useFamilyStore } from '@/stores/family'
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts
```

Expected before implementation: test fails because `onNodeDrop` persists manual position in all modes.

- [ ] **Step 3: Prevent center layout from persisting manual positions**

Modify `onNodeDrop` in `src/components/tree/FamilyCanvas.vue`:

```ts
function onNodeDrop(payload: { id: string; dx: number; dy: number }) {
  const scale = screenToStageScale()
  const base = placedNodes.value.find((p) => p.id === payload.id)
  delete dragDelta[payload.id]
  if (!base) return
  if (props.centerLayoutId) return
  const stageDx = payload.dx / scale
  const stageDy = payload.dy / scale
  let newLeft = base.left + stageDx
  let newTop = base.top + stageDy
  newLeft = Math.round(newLeft / SNAP_PX) * SNAP_PX
  newTop = Math.round(newTop / SNAP_PX) * SNAP_PX
  const cxWithOffset = (newLeft + NODE_W_PX / 2 - PADDING) / CELL_PX
  const top = (newTop - PADDING) / CELL_PX
  const cx = cxWithOffset - layout.value.offsetX
  family.setManualPosition(payload.id, cx, top)
}
```

- [ ] **Step 4: Run component test**

Run:

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts
```

Expected: all `FamilyCanvas` tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "fix: keep center layout from persisting manual positions"
```

---

### Task 7: Update Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-24-layout-engine-redesign.md`

- [ ] **Step 1: Update README layout description**

In `README.md`, replace the layout bullet with:

```md
- **家族树可视化** — 默认使用强约束家庭单元布局：配偶/父母作为家庭单元，子女按代际和出生日期稳定排列；支持缩放、拖拽和默认布局下的手工位置覆盖
```

- [ ] **Step 2: Update layout design note**

Append this section to `docs/superpowers/specs/2026-05-24-layout-engine-redesign.md`:

```md
## 2026-06-25 默认布局方案调整

默认布局不再把所有人节点直接交给通用自由布局处理，而是先构建语义模型：

- PersonNode：真实成员
- UnionNode：父母/配偶/单亲家庭单元
- ChildGroup：同一 Union 下的子女集合
- Component：不连通家族分量

布局目标从“让通用图算法自由寻找坐标”调整为“先满足家谱语义约束，再做稳定排布”。中心布局仍作为独立关系探索模式，不共享默认布局的手工位置持久化语义。
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected:

- `npm test`: all test files pass.
- `npm run typecheck`: `vue-tsc --noEmit` exits 0.
- `npm run build`: Vite build exits 0. Existing large chunk warning is acceptable for this plan.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md docs/superpowers/specs/2026-05-24-layout-engine-redesign.md
git commit -m "docs: document constraint family layout"
```

---

## Self-Review

Spec coverage:

- Strong semantic model: Task 1.
- Deterministic family-unit layout: Task 2.
- Public default API switch: Task 3.
- Manual position semantics: Task 4.
- Realistic regression fixtures: Task 5.
- Center/default layout separation: Task 6.
- Documentation: Task 7.

Placeholder scan:

- No task uses open-ended implementation placeholders.
- Each code-modifying task includes exact target files, test commands, and expected result.

Type consistency:

- Public default API remains `layoutFamilyTree`.
- New engine is `layoutConstraintFamilyTree`.
- Semantic model builder is `buildFamilyGraphModel`.
- `LayoutResult` remains imported from the existing public layout type surface.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-06-25-constraint-family-layout.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Choose one before implementation begins.

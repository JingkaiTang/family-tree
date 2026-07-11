# Family Unit Grid Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current slot-based layout with a deterministic family-unit grid engine that keeps blood relatives close, moves current couples as one unit, and routes every family's lines without card interference or cross-family segment overlap.

**Architecture:** Build a pure TypeScript pipeline under `src/core/family-layout`: normalize facts, project the default relationship view, build family units, assign generations, cluster lineages, order units, compact them onto a logical grid, route family-owned lanes, and validate the final scene. Vue renders the resulting `LayoutScene`; drag/drop persists semantic row sequences and triggers local reflow instead of saving free coordinates.

**Tech Stack:** Vue 3, Pinia, TypeScript, Zod, Vitest, SVG, existing pan/zoom and Tauri runtime. Do not add a graph-layout or constraint-solver dependency.

## Global Constraints

- Default target size is 500 members.
- Each person renders exactly once in the primary scene.
- A current couple is one indivisible `FamilyUnit`; historical partnerships stay in the auxiliary layer.
- Primary parent-child edges use family-owned solid-colored routes; auxiliary relationships use separate dashed routes.
- Different route owners may cross at a point but may never share a positive-length horizontal or vertical segment or form a false T-junction.
- Only edges with the same `ParentageGroup.id` may share a stem or child bus.
- Cards, family-unit bounds, and unrelated routes are hard obstacles.
- Grid defaults are 24px main cells, 8px route subcells, 168×216px cards, 72px family gaps, and 360px initial generation pitch.
- Drag/drop is same-generation only; neighboring units drift during preview; direct child blocks re-center after drop; unrelated components stay fixed.
- Layout output is deterministic for identical facts, view policy, preferences, metrics, and previous scene.
- The initial engine stays synchronous and pure, with an async facade and a future Worker boundary.
- Preserve V2 data fields during migration; legacy manual coordinates remain deprecated and ignored.
- Follow TDD for every task and commit after every independently reviewable deliverable.

---

## Scope Check

The spec spans several modules, but they form one dependency chain and one user-visible feature. Routing depends on grid coordinates, grid compaction depends on semantic units, and drag behavior depends on the scene metadata. Keep one implementation plan and review each task independently.

## File Structure

### New core files

- `src/core/family-layout/types.ts`: all public and intermediate layout types plus default metrics.
- `src/core/family-layout/testHelpers.ts`: deterministic member builders and scene assertion helpers used only by tests.
- `src/core/family-layout/normalizeFacts.ts`: convert current `FamilyData` refs into stable `Person`, `Partnership`, and `Parentage` facts with diagnostics.
- `src/core/family-layout/projectView.ts`: choose primary partnerships/parentage and emit auxiliary relations without changing facts.
- `src/core/family-layout/buildFamilyUnits.ts`: create single/couple units, hubs, parentage groups, and stable unit mappings.
- `src/core/family-layout/assignGenerations.ts`: spouse equality, parent-child ranks, pedigree-collapse support, and cycle diagnostics.
- `src/core/family-layout/clusterLineages.ts`: blood cores, bridge bands, and dense supercomponents.
- `src/core/family-layout/orderUnits.ts`: stable block ordering and six-pass barycenter sweeps.
- `src/core/family-layout/compactGrid.ts`: variable-width unit placement, grid snapping, component packing, and partial scene geometry.
- `src/core/family-layout/routeFamilyLanes.ts`: ports, obstacles, family-owned buses, vertical sublanes, and crossing bridges.
- `src/core/family-layout/routeAuxiliaryEdges.ts`: historical, secondary-parent, and godparent routing outside primary lanes.
- `src/core/family-layout/reconcilePreferences.ts`: restore row sequences and convert V2 slot overrides.
- `src/core/family-layout/validateScene.ts`: semantic and geometric hard-invariant validation.
- `src/core/family-layout/buildSafeFallbackScene.ts`: non-overlapping card-only fallback for irrecoverable malformed components.
- `src/core/family-layout/layoutFamilyScene.ts`: orchestration-only public pure function.

### New UI files

- `src/components/tree/FamilyUnit.vue`: render a soft family background, one or two `MemberNode`s, spouse axis, union hub, and group drag events.
- `src/components/tree/RelationLayer.vue`: render primary/auxiliary SVG paths, bridges, and route highlight state.
- `src/components/tree/GridBackground.vue`: render the logical 24px grid independently from scene content.

### Modified files

- `src/core/schema.ts`: schema V3 layout preferences.
- `src/core/migrate.ts`: V2-to-V3 layout preference migration.
- `src/stores/family.ts`: row-order and family-accent actions; retire new writes to manual/grid overrides.
- `src/stores/ui.ts`: auxiliary-relation visibility.
- `src/core/treeLayout.ts`: async facade over the new pure engine.
- `src/components/tree/FamilyCanvas.vue`: scene rendering, family-unit drag preview, and local reflow.
- `src/components/tree/MemberNode.vue`: support rendering inside a family unit without owning persisted drag semantics.
- `src/pages/TreeView.vue`: pass layout preferences and auxiliary-layer state.
- `src/__tests__/fixtures/families.ts`: cross-marriage, bridge-band, error, and large deterministic fixtures.
- `src/core/treeLayout.test.ts`: public-scene invariants.
- `src/__tests__/components/FamilyCanvas.test.ts`: family-unit rendering and drag behavior.
- `src/__tests__/e2e/scenarios/layout-verification.test.ts`: user-visible routing and geometry invariants.
- `README.md`: new layout behavior and architecture.
- `package.json`: remove `elkjs` only after legacy production paths are removed.

### Removed after the new facade passes all verification

- `src/core/elkLayout.ts`
- `src/core/elkLayout.test.ts`
- `src/core/layout/familyGraphModel.ts`
- `src/core/layout/familyGraphModel.test.ts`
- `src/core/layout/constraintFamilyLayout.ts`
- `src/core/layout/constraintFamilyLayout.test.ts`
- `src/core/layout/gridFamilyModel.ts`
- `src/core/layout/gridFamilyModel.test.ts`
- `src/core/layout/gridFamilyLayout.ts`
- `src/core/layout/gridFamilyLayout.test.ts`

---

### Task 1: Core Types, Test Helpers, And Fact Normalization

**Files:**
- Create: `src/core/family-layout/types.ts`
- Create: `src/core/family-layout/testHelpers.ts`
- Create: `src/core/family-layout/normalizeFacts.ts`
- Create: `src/core/family-layout/normalizeFacts.test.ts`

**Interfaces:**
- Consumes: `FamilyData`, `Member` from `src/core/schema.ts`.
- Produces: `normalizeFacts(data: FamilyData): NormalizedFactsResult`, `DEFAULT_LAYOUT_METRICS`, and the shared types used by every later task.

- [ ] **Step 1: Write failing normalization tests**

Create `src/core/family-layout/normalizeFacts.test.ts` with exact cases for stable partnerships, grouped parentage, and missing refs:

```ts
import { describe, expect, it } from 'vitest'
import { createEmptyFamily } from '@/core/schema'
import { familyData, linkParent, linkSpouse, member } from './testHelpers'
import { normalizeFacts } from './normalizeFacts'

describe('normalizeFacts', () => {
  it('creates deterministic current partnership and parentage facts', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = normalizeFacts(familyData([kid, mom, dad]))

    expect(result.facts.partnerships).toEqual([{
      id: 'partnership:current:dad+mom',
      partnerIds: ['dad', 'mom'],
      status: 'current',
    }])
    expect(result.facts.parentages).toEqual([{
      id: 'parentage:dad+mom',
      parentIds: ['dad', 'mom'],
      childIds: ['kid'],
      typeByChildId: { kid: 'blood' },
    }])
    expect(result.diagnostics).toEqual([])
  })

  it('keeps valid people and reports missing references', () => {
    const data = createEmptyFamily()
    data.members.kid = member('kid', {
      parents: [{ id: 'missing-parent', type: 'blood' }],
    })

    const result = normalizeFacts(data)

    expect(result.facts.people.map(person => person.id)).toEqual(['kid'])
    expect(result.facts.parentages).toEqual([])
    expect(result.diagnostics).toEqual([{
      code: 'MISSING_REFERENCE',
      ids: ['kid', 'missing-parent'],
      message: 'kid references missing member missing-parent',
    }])
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/core/family-layout/normalizeFacts.test.ts
```

Expected: FAIL because `testHelpers.ts`, `types.ts`, and `normalizeFacts.ts` do not exist.

- [ ] **Step 3: Define the shared types and defaults**

Create `src/core/family-layout/types.ts` with these public shapes and exact defaults:

```ts
import type { Member } from '@/core/schema'

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export type LayoutDiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'PARENTAGE_CYCLE'
  | 'INVALID_PRIMARY_PARTNERSHIP'
  | 'INVALID_PRIMARY_PARENTAGE'
  | 'UNROUTABLE_PRIMARY_EDGE'
  | 'CROSS_FAMILY_SEGMENT_OVERLAP'
  | 'NODE_OVERLAP'

export interface LayoutDiagnostic {
  code: LayoutDiagnosticCode
  ids: string[]
  message: string
}

export interface PersonFact { id: string; member: Member }
export interface PartnershipFact {
  id: string
  partnerIds: string[]
  status: 'current' | 'historical'
}
export interface ParentageFact {
  id: string
  parentIds: string[]
  childIds: string[]
  typeByChildId: Record<string, 'blood' | 'adopted' | 'step'>
}
export interface FamilyFacts {
  people: PersonFact[]
  partnerships: PartnershipFact[]
  parentages: ParentageFact[]
}
export interface NormalizedFactsResult {
  facts: FamilyFacts
  diagnostics: LayoutDiagnostic[]
}

export interface FamilyViewPolicy {
  primaryPartnershipByPerson: Record<string, string>
  primaryParentageByChild: Record<string, string>
  showHistoricalPartnerships: boolean
  showSecondaryParentage: boolean
  showGodparentRelations: boolean
}

export const DEFAULT_FAMILY_VIEW_POLICY: FamilyViewPolicy = {
  primaryPartnershipByPerson: {},
  primaryParentageByChild: {},
  showHistoricalPartnerships: false,
  showSecondaryParentage: false,
  showGodparentRelations: false,
}

export interface RowOrderPreference { id: string; unitIds: string[] }
export interface LayoutPreferences {
  rowOrders: RowOrderPreference[]
  familyAccentAssignments: Record<string, string>
}

export const EMPTY_LAYOUT_PREFERENCES: LayoutPreferences = {
  rowOrders: [],
  familyAccentAssignments: {},
}

export interface LayoutMetrics {
  gridSize: number
  cardWidth: number
  cardHeight: number
  spouseGap: number
  familyGap: number
  generationGap: number
  routeSubgrid: number
  cardClearance: number
}

export const DEFAULT_LAYOUT_METRICS: LayoutMetrics = {
  gridSize: 24,
  cardWidth: 168,
  cardHeight: 216,
  spouseGap: 24,
  familyGap: 72,
  generationGap: 360,
  routeSubgrid: 8,
  cardClearance: 12,
}

export interface LayoutRequest {
  facts: FamilyFacts
  view: FamilyViewPolicy
  preferences: LayoutPreferences
  metrics: LayoutMetrics
  inputDiagnostics: LayoutDiagnostic[]
  previousScene?: LayoutScene
  changedIds?: string[]
}

export interface FamilyUnit {
  id: string
  kind: 'single' | 'couple'
  memberIds: string[]
  generation: number
  width: number
  lineageAffinity: Record<string, number>
  accent: string
}
export interface ParentageGroup {
  id: string
  sourceUnitId: string
  childPersonIds: string[]
}
export interface AuxiliaryRelation {
  id: string
  kind: 'historical-partnership' | 'secondary-partnership' | 'secondary-parentage' | 'godparent'
  sourceId: string
  targetId: string
}
export interface ProjectedFamily {
  people: PersonFact[]
  primaryPartnerships: PartnershipFact[]
  primaryParentages: ParentageFact[]
  auxiliaryRelations: AuxiliaryRelation[]
  diagnostics: LayoutDiagnostic[]
}
export interface PlacedFamilyUnit extends FamilyUnit { rect: Rect; order: number }
export interface PlacedPersonCard { id: string; unitId: string; rect: Rect; generation: number }
export interface PlacedUnionHub { id: string; unitId: string; point: Point }
export interface PlacedRow { id: string; generation: number; unitIds: string[] }
export interface RouteSegment {
  orientation: 'horizontal' | 'vertical' | 'bridge'
  points: Point[]
}
export interface RoutedFamilyEdge {
  id: string
  routeOwnerId: string
  kind: 'primary' | 'historical-partnership' | 'secondary-parentage' | 'godparent'
  accent: string
  segments: RouteSegment[]
}
export interface LayoutScene {
  units: PlacedFamilyUnit[]
  cards: PlacedPersonCard[]
  hubs: PlacedUnionHub[]
  rows: PlacedRow[]
  routes: RoutedFamilyEdge[]
  bounds: Rect
  diagnostics: LayoutDiagnostic[]
}
```

- [ ] **Step 4: Add deterministic test helpers**

Create `src/core/family-layout/testHelpers.ts` with `member`, `familyData`, `linkParent`, and `linkSpouse`. Use the exact field defaults from `src/__tests__/fixtures/families.ts`, and make `familyData` merge `createEmptyFamily()` before replacing `members`.

```ts
import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'

export function member(id: string, patch: Partial<Member> = {}): Member {
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

export function familyData(members: Member[], patch: Partial<FamilyData> = {}): FamilyData {
  return {
    ...createEmptyFamily(),
    members: Object.fromEntries(members.map(value => [value.id, value])),
    ...patch,
  }
}

export function linkParent(child: Member, parent: Member, type: 'blood' | 'adopted' | 'step' = 'blood') {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}

export function linkSpouse(left: Member, right: Member, type: 'married' | 'divorced' = 'married') {
  left.spouses.push({ id: right.id, type })
  right.spouses.push({ id: left.id, type })
}
```

- [ ] **Step 5: Implement fact normalization**

Create `src/core/family-layout/normalizeFacts.ts`. Sort all IDs with `localeCompare`, deduplicate partnership pairs, group children by sorted valid parent IDs, choose `blood` before `adopted` before `step` when inconsistent refs describe the same child, and append one diagnostic per missing ref.

```ts
import type { FamilyData } from '@/core/schema'
import type { NormalizedFactsResult, ParentageFact, PartnershipFact } from './types'

const TYPE_PRIORITY = { blood: 0, adopted: 1, step: 2 } as const

export function normalizeFacts(data: FamilyData): NormalizedFactsResult {
  const diagnostics: NormalizedFactsResult['diagnostics'] = []
  const people = Object.values(data.members)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(member => ({ id: member.id, member }))
  const knownIds = new Set(people.map(person => person.id))
  const partnershipById = new Map<string, PartnershipFact>()

  for (const person of people) {
    for (const spouse of person.member.spouses) {
      if (!knownIds.has(spouse.id)) {
        diagnostics.push({
          code: 'MISSING_REFERENCE',
          ids: [person.id, spouse.id],
          message: `${person.id} references missing member ${spouse.id}`,
        })
        continue
      }
      if (spouse.id === person.id) continue
      const partnerIds = [person.id, spouse.id].sort((a, b) => a.localeCompare(b))
      const status = spouse.type === 'married' ? 'current' : 'historical'
      const id = `partnership:${status}:${partnerIds.join('+')}`
      partnershipById.set(id, { id, partnerIds, status })
    }
  }

  const parentageById = new Map<string, ParentageFact>()
  for (const child of people) {
    const validParents = child.member.parents
      .filter(parent => {
        if (knownIds.has(parent.id)) return parent.id !== child.id
        diagnostics.push({
          code: 'MISSING_REFERENCE',
          ids: [child.id, parent.id],
          message: `${child.id} references missing member ${parent.id}`,
        })
        return false
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    const parentIds = [...new Set(validParents.map(parent => parent.id))]
    if (parentIds.length === 0) continue
    const id = `parentage:${parentIds.join('+')}`
    const existing = parentageById.get(id) ?? {
      id,
      parentIds,
      childIds: [],
      typeByChildId: {},
    }
    existing.childIds.push(child.id)
    existing.typeByChildId[child.id] = [...validParents]
      .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])[0].type
    parentageById.set(id, existing)
  }

  const parentages = [...parentageById.values()].map(parentage => ({
    ...parentage,
    childIds: [...new Set(parentage.childIds)].sort((a, b) => a.localeCompare(b)),
  })).sort((a, b) => a.id.localeCompare(b.id))

  return {
    facts: {
      people,
      partnerships: [...partnershipById.values()].sort((a, b) => a.id.localeCompare(b.id)),
      parentages,
    },
    diagnostics: diagnostics.sort((a, b) => a.message.localeCompare(b.message)),
  }
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- src/core/family-layout/normalizeFacts.test.ts
npm run typecheck
```

Expected: both pass.

Commit:

```bash
git add src/core/family-layout
git commit -m "feat: add normalized family layout facts"
```

---

### Task 2: Default View Projection And Family Units

**Files:**
- Create: `src/core/family-layout/projectView.ts`
- Create: `src/core/family-layout/projectView.test.ts`
- Create: `src/core/family-layout/buildFamilyUnits.ts`
- Create: `src/core/family-layout/buildFamilyUnits.test.ts`

**Interfaces:**
- Consumes: `FamilyFacts`, `FamilyViewPolicy`, and `LayoutPreferences` from Task 1.
- Produces: `projectView(facts, view): ProjectedFamily` and `buildFamilyUnits(projected, preferences, metrics): BuiltFamilyUnits`.

- [ ] **Step 1: Write failing projection and unit tests**

Add tests that prove current spouses become one unit, historical spouses become auxiliary, every person maps to one unit, and a single parent owns a parentage group:

```ts
it('projects current partnership into one couple unit and historical partnership into auxiliary data', () => {
  const a = member('a')
  const b = member('b')
  const ex = member('ex')
  linkSpouse(a, b, 'married')
  linkSpouse(a, ex, 'divorced')
  const { facts } = normalizeFacts(familyData([a, b, ex]))

  const projected = projectView(facts, {
    primaryPartnershipByPerson: {},
    primaryParentageByChild: {},
    showHistoricalPartnerships: true,
    showSecondaryParentage: false,
    showGodparentRelations: false,
  })
  const built = buildFamilyUnits(projected, {
    rowOrders: [],
    familyAccentAssignments: {},
  }, DEFAULT_LAYOUT_METRICS)

  expect(built.units.find(unit => unit.kind === 'couple')?.memberIds).toEqual(['a', 'b'])
  expect(Object.keys(built.unitIdByPersonId).sort()).toEqual(['a', 'b', 'ex'])
  expect(projected.auxiliaryRelations).toContainEqual({
    id: 'aux:partnership:historical:a+ex',
    kind: 'historical-partnership',
    sourceId: 'a',
    targetId: 'ex',
  })
})
```

Run:

```bash
npm test -- src/core/family-layout/projectView.test.ts src/core/family-layout/buildFamilyUnits.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 2: Implement deterministic view projection**

Implement `projectView` with these rules:

```ts
export function projectView(facts: FamilyFacts, view: FamilyViewPolicy): ProjectedFamily {
  const diagnostics: LayoutDiagnostic[] = []
  const selectedPartnershipIds = new Set<string>()
  const assignedPeople = new Set<string>()
  const currentPartnerships = facts.partnerships
    .filter(value => value.status === 'current')
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const partnership of currentPartnerships) {
    const explicitlySelected = partnership.partnerIds.every(
      personId => view.primaryPartnershipByPerson[personId] === partnership.id,
    )
    if (!explicitlySelected) continue
    selectedPartnershipIds.add(partnership.id)
    partnership.partnerIds.forEach(personId => assignedPeople.add(personId))
  }
  for (const partnership of currentPartnerships) {
    if (selectedPartnershipIds.has(partnership.id)) continue
    if (partnership.partnerIds.some(personId => assignedPeople.has(personId))) continue
    selectedPartnershipIds.add(partnership.id)
    partnership.partnerIds.forEach(personId => assignedPeople.add(personId))
  }
  for (const [personId, partnershipId] of Object.entries(view.primaryPartnershipByPerson)) {
    if (selectedPartnershipIds.has(partnershipId)) continue
    diagnostics.push({
      code: 'INVALID_PRIMARY_PARTNERSHIP',
      ids: [personId, partnershipId],
      message: `Invalid primary partnership ${partnershipId} for ${personId}`,
    })
  }

  const primaryPartnerships = facts.partnerships
    .filter(value => selectedPartnershipIds.has(value.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  const parentagesByChildId = new Map<string, ParentageFact[]>()
  for (const parentage of facts.parentages) {
    for (const childId of parentage.childIds) {
      const list = parentagesByChildId.get(childId) ?? []
      list.push(parentage)
      parentagesByChildId.set(childId, list)
    }
  }
  const selectedParentageIdByChild = new Map<string, string>()
  for (const [childId, parentages] of parentagesByChildId) {
    parentages.sort((a, b) => a.id.localeCompare(b.id))
    const explicit = view.primaryParentageByChild[childId]
    const selected = parentages.find(value => value.id === explicit) ?? parentages[0]
    selectedParentageIdByChild.set(childId, selected.id)
    if (explicit !== undefined && explicit !== selected.id) {
      diagnostics.push({
        code: 'INVALID_PRIMARY_PARENTAGE',
        ids: [childId, explicit],
        message: `Invalid primary parentage ${explicit} for ${childId}`,
      })
    }
  }
  const primaryParentages = facts.parentages
    .map(parentage => ({
      ...parentage,
      childIds: parentage.childIds.filter(
        childId => selectedParentageIdByChild.get(childId) === parentage.id,
      ),
    }))
    .filter(parentage => parentage.childIds.length > 0)
  const auxiliaryRelations: AuxiliaryRelation[] = []

  if (view.showHistoricalPartnerships) {
    for (const partnership of facts.partnerships.filter(value => value.status === 'historical')) {
      auxiliaryRelations.push({
        id: `aux:${partnership.id}`,
        kind: 'historical-partnership',
        sourceId: partnership.partnerIds[0],
        targetId: partnership.partnerIds[1],
      })
    }
    for (const partnership of currentPartnerships.filter(value => !selectedPartnershipIds.has(value.id))) {
      auxiliaryRelations.push({
        id: `aux:secondary:${partnership.id}`,
        kind: 'secondary-partnership',
        sourceId: partnership.partnerIds[0],
        targetId: partnership.partnerIds[1],
      })
    }
  }

  if (view.showSecondaryParentage) {
    for (const parentage of facts.parentages) {
      for (const childId of parentage.childIds) {
        if (selectedParentageIdByChild.get(childId) === parentage.id) continue
        for (const parentId of parentage.parentIds) {
          auxiliaryRelations.push({
            id: `aux:${parentage.id}:${parentId}:${childId}`,
            kind: 'secondary-parentage',
            sourceId: parentId,
            targetId: childId,
          })
        }
      }
    }
  }

  if (view.showGodparentRelations) {
    const knownIds = new Set(facts.people.map(person => person.id))
    for (const person of facts.people) {
      for (const godparent of person.member.godparents) {
        if (!knownIds.has(godparent.id)) continue
        auxiliaryRelations.push({
          id: `aux:godparent:${godparent.id}>${person.id}`,
          kind: 'godparent',
          sourceId: godparent.id,
          targetId: person.id,
        })
      }
    }
  }

  return {
    people: facts.people,
    primaryPartnerships,
    primaryParentages,
    auxiliaryRelations: [...new Map(auxiliaryRelations.map(value => [value.id, value])).values()]
      .sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: diagnostics.sort((a, b) => a.message.localeCompare(b.message)),
  }
}
```

- [ ] **Step 3: Implement family-unit construction**

Define and export this result beside `buildFamilyUnits`:

```ts
export interface BuiltFamilyUnits {
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  unitIdByPersonId: Record<string, string>
}
```

Construction requirements:

- Create couple units first from selected current partnerships.
- A person already assigned to a couple cannot enter another primary couple.
- Create single units for unassigned people.
- Use `unit:${partnership.id}` and `unit:person:${personId}` as stable IDs.
- Use the persisted accent when present. Otherwise start at `stableHash(unit.id) % FAMILY_ACCENTS.length` and advance through the palette until the color differs from directly related parent/child units already assigned. This keeps color deterministic without mutating persisted data during layout.
- For each primary parentage, choose the unit containing the most parent IDs; stable ID breaks ties.
- Sort children by birth date, then member ID.

Use this exact palette:

```ts
export const FAMILY_ACCENTS = [
  '#d6578b', '#5a78c9', '#2f9d7e', '#d48932',
  '#7c5ac7', '#4b9aaa', '#ba5f45', '#6f8f3d',
] as const

export function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- src/core/family-layout/projectView.test.ts src/core/family-layout/buildFamilyUnits.test.ts
npm run typecheck
git add src/core/family-layout
git commit -m "feat: build primary family layout units"
```

Expected: tests and typecheck pass before commit.

---

### Task 3: Generation Assignment And Cycle Diagnostics

**Files:**
- Create: `src/core/family-layout/assignGenerations.ts`
- Create: `src/core/family-layout/assignGenerations.test.ts`

**Interfaces:**
- Consumes: `BuiltFamilyUnits`, `ProjectedFamily`.
- Produces: `assignGenerations(input): GenerationResult` where `generationByUnitId` contains every unit and diagnostics contains any real parentage cycles.

- [ ] **Step 1: Write failing generation tests**

Cover spouse equality, three generations, godparent exclusion, pedigree collapse, and a true parent cycle:

```ts
it('reports a true parentage cycle without dropping units', () => {
  const a = member('a')
  const b = member('b')
  linkParent(b, a)
  linkParent(a, b)
  const input = buildProjectedInput(familyData([a, b]))

  const result = assignGenerations(input.projected, input.built)

  expect(Object.keys(result.generationByUnitId).sort()).toEqual([
    'unit:person:a',
    'unit:person:b',
  ])
  expect(result.diagnostics[0]).toMatchObject({ code: 'PARENTAGE_CYCLE' })
})
```

Add `buildProjectedInput` to `testHelpers.ts`:

```ts
export function buildProjectedInput(data: FamilyData) {
  const normalized = normalizeFacts(data)
  const projected = projectView(normalized.facts, DEFAULT_FAMILY_VIEW_POLICY)
  const built = buildFamilyUnits(
    projected,
    EMPTY_LAYOUT_PREFERENCES,
    DEFAULT_LAYOUT_METRICS,
  )
  return { normalized, projected, built }
}
```

Run:

```bash
npm test -- src/core/family-layout/assignGenerations.test.ts
```

Expected: FAIL because `assignGenerations.ts` does not exist.

- [ ] **Step 2: Implement rank assignment**

Export:

```ts
export interface GenerationResult {
  generationByUnitId: Record<string, number>
  cyclicUnitIds: string[]
  diagnostics: LayoutDiagnostic[]
}
```

Implementation sequence:

1. Build directed edges from each `ParentageGroup.sourceUnitId` to each child's unit.
2. Ignore self-edges produced by malformed primary selection and report them as cycles.
3. Run Tarjan SCC over unit IDs.
4. Mark SCCs with more than one unit, or one unit with a self-edge, as cyclic.
5. Collapse SCCs into a DAG.
6. Use Kahn topological order and longest-path relaxation to assign ranks.
7. Give cyclic SCC members the same stable fallback rank, then place their SCC one row below its noncyclic predecessors.
8. Normalize minimum rank to zero.
9. Copy the resulting generation onto each `FamilyUnit` without mutating the input array.

The implementation must not inspect godparent relations.

- [ ] **Step 3: Verify targeted and existing tests**

```bash
npm test -- src/core/family-layout/assignGenerations.test.ts src/core/kinship/kinship.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/family-layout/assignGenerations.ts src/core/family-layout/assignGenerations.test.ts src/core/family-layout/testHelpers.ts
git commit -m "feat: assign stable family generations"
```

---

### Task 4: Lineage Clustering And Stable Unit Ordering

**Files:**
- Create: `src/core/family-layout/clusterLineages.ts`
- Create: `src/core/family-layout/clusterLineages.test.ts`
- Create: `src/core/family-layout/orderUnits.ts`
- Create: `src/core/family-layout/orderUnits.test.ts`
- Modify: `src/core/family-layout/types.ts`

**Interfaces:**
- Consumes: projected parentage, family units with generations, row-order preferences, optional previous scene.
- Produces: `clusterLineages(...)` and `orderUnits(...)` with ordered unit IDs for every generation.

- [ ] **Step 1: Add lineage cluster types and failing tests**

Add to `types.ts`:

```ts
export interface LineageCluster {
  id: string
  unitIds: string[]
  personIds: string[]
  kind: 'core' | 'bridge' | 'supercomponent'
}
export interface OrderedGeneration {
  generation: number
  unitIds: string[]
}
```

Test three confirmed cases:

- One cross-lineage partnership keeps two cores and one bridge.
- Two cross-lineage partnerships between the same two cores create a bridge band.
- A cycle in the lineage-bridge graph creates one `supercomponent`.

Use a fixture where A siblings marry B siblings for the second case.

- [ ] **Step 2: Implement lineage clustering**

Use only `blood` parentage to build blood cores. Adopted and step parentage contribute affinity `0.5` during ordering but do not merge cores.

Classification rules are exact:

- A partnership whose members belong to different blood cores is a bridge edge.
- One bridge edge between a pair of cores stays a single bridge.
- Two or more bridge edges between the same pair form a bridge band.
- A connected bridge graph containing a graph cycle becomes one supercomponent.
- A core pair with three or more bridge edges also becomes a supercomponent even if the core graph has only two vertices.

Return cluster arrays sorted by cluster ID and unit IDs sorted by stable unit ID.

- [ ] **Step 3: Write failing ordering tests**

Tests must prove:

- A saved row sequence wins over birth-date order.
- Couple units remain indivisible.
- Sibling child units remain contiguous when no cross-marriage conflict exists.
- A/B cross-marriage units occupy the bridge band between A and B cores.
- Identical inputs produce byte-identical ordered rows.

Use this preference shape:

```ts
const preferences: LayoutPreferences = {
  rowOrders: [{
    id: 'row-preference-1',
    unitIds: ['unit:person:c', 'unit:person:a', 'unit:person:b'],
  }],
  familyAccentAssignments: {},
}
```

- [ ] **Step 4: Implement six-pass stable ordering**

Export:

```ts
export interface OrderUnitsInput {
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  clusters: LineageCluster[]
  preferences: LayoutPreferences
  previousScene?: LayoutScene
  changedIds?: string[]
}

export function orderUnits(input: OrderUnitsInput): OrderedGeneration[]
```

Implementation requirements:

1. Group units by generation.
2. Reconcile the saved row with maximum unit-ID overlap.
3. Seed remaining order by birth date, then stable ID.
4. Treat couple units as atomic because they are already one unit.
5. Create child blocks from parentage groups unless a unit belongs to a cross-marriage bridge band.
6. Run three downward and three upward barycenter passes.
7. Compare swaps lexicographically by saved-order violations, crossings, lineage distance, previous-scene movement, and total span.
8. Break ties by stable unit ID.
9. When `previousScene` and `changedIds` are present, preserve the exact unit order of components containing no changed person, parent, or child.

- [ ] **Step 5: Run and commit**

```bash
npm test -- src/core/family-layout/clusterLineages.test.ts src/core/family-layout/orderUnits.test.ts
npm run typecheck
git add src/core/family-layout
git commit -m "feat: order family units by lineage affinity"
```

---

### Task 5: Grid Compaction And Scene Geometry

**Files:**
- Create: `src/core/family-layout/compactGrid.ts`
- Create: `src/core/family-layout/compactGrid.test.ts`
- Modify: `src/core/family-layout/types.ts`

**Interfaces:**
- Consumes: ordered generations, family units, parentage groups, metrics, previous scene, and changed person IDs.
- Produces: `compactGrid(input): SceneGeometry` containing placed units, person cards, hubs, bounds, and row metadata but no routes.

- [ ] **Step 1: Add scene-geometry types and failing tests**

Add:

```ts
export interface SceneGeometry {
  units: PlacedFamilyUnit[]
  cards: PlacedPersonCard[]
  hubs: PlacedUnionHub[]
  rows: PlacedRow[]
  bounds: Rect
}
```

Tests must assert:

- Every unit x-coordinate is divisible by 24.
- No two unit rectangles overlap.
- Couple cards stay 24px apart inside one unit.
- Parent unit center aligns to a simple child block center within one 24px grid cell.
- Disconnected components have at least `familyGap * 2` between bounds.
- Empty input returns zero bounds and empty arrays.

- [ ] **Step 2: Implement unit sizes and internal geometry**

Use exact dimensions:

```ts
export function familyUnitWidth(unit: FamilyUnit, metrics: LayoutMetrics): number {
  return unit.kind === 'couple'
    ? metrics.cardWidth * 2 + metrics.spouseGap
    : metrics.cardWidth
}
```

For couple units, create left and right card rects and put the union hub at the center of the spouse gap at 50% card height. For single-parent units, create a hub at card bottom center only when the unit owns a parentage group.

- [ ] **Step 3: Implement row compaction**

For each ordered row:

1. Compute desired unit centers from parent centers or child-block centers.
2. Forward-scan to enforce `previous.right + familyGap`.
3. Backward-scan to reclaim unused left space without crossing the minimum gap.
4. Repeat center alignment and scans four times.
5. Snap unit left positions with `Math.round(x / gridSize) * gridSize`.
6. Re-run the forward scan after snapping.
7. Shift the whole component so minimum x is zero.

Pack disconnected components left-to-right with `familyGap * 2` and preserve previous component order when available.

When `previousScene` and `changedIds` are present, use previous x positions as fixed desired centers for components containing no changed person. Only the affected component may be re-compacted.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/core/family-layout/compactGrid.test.ts
npm run typecheck
git add src/core/family-layout
git commit -m "feat: compact family units onto the grid"
```

---

### Task 6: Family-Owned Lane Routing And Scene Validation

**Files:**
- Create: `src/core/family-layout/routeFamilyLanes.ts`
- Create: `src/core/family-layout/routeFamilyLanes.test.ts`
- Create: `src/core/family-layout/validateScene.ts`
- Create: `src/core/family-layout/validateScene.test.ts`
- Modify: `src/core/family-layout/testHelpers.ts`

**Interfaces:**
- Consumes: `SceneGeometry`, parentage groups, units, metrics.
- Produces: `routeFamilyLanes(input): RouteFamilyLanesResult` and `validateScene(scene, metrics): LayoutDiagnostic[]`.

Add this result type to `types.ts`:

```ts
export interface RouteFamilyLanesResult {
  routes: RoutedFamilyEdge[]
  diagnostics: LayoutDiagnostic[]
}
```

- [ ] **Step 1: Add reusable geometric assertions**

Add to `testHelpers.ts`:

```ts
export function segmentKey(segment: RouteSegment): string {
  const points = segment.points.map(point => `${point.x},${point.y}`).join('>')
  return `${segment.orientation}:${points}`
}

export function positiveCollinearOverlap(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation !== right.orientation) return false
  if (left.orientation === 'bridge' || right.orientation === 'bridge') return false
  const [a0, a1] = left.points
  const [b0, b1] = right.points
  if (left.orientation === 'horizontal') {
    if (a0.y !== b0.y) return false
    return Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x))
      < Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x))
  }
  if (a0.x !== b0.x) return false
  return Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y))
    < Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y))
}
```

- [ ] **Step 2: Write failing router tests for the reported bug**

Create a fixture with five same-generation families whose child spans overlap. Assert:

```ts
for (let i = 0; i < routes.length; i++) {
  for (let j = i + 1; j < routes.length; j++) {
    if (routes[i].routeOwnerId === routes[j].routeOwnerId) continue
    for (const left of routes[i].segments) {
      for (const right of routes[j].segments) {
        expect(positiveCollinearOverlap(left, right)).toBe(false)
      }
    }
  }
}
```

Also assert every route starts at its source hub, ends exactly at each child top port, does not intersect expanded unrelated card rects, and emits one bridge for an unavoidable perpendicular crossing.

Run:

```bash
npm test -- src/core/family-layout/routeFamilyLanes.test.ts
```

Expected: FAIL because the router is missing.

- [ ] **Step 3: Implement lane allocation**

Use one route request per `ParentageGroup` and this exact lane structure:

```ts
interface LaneOccupancy {
  y: number
  intervals: Array<{ minX: number; maxX: number; routeOwnerId: string }>
}
```

Algorithm:

1. Build each bus interval from minimum to maximum child top-port x.
2. Sort requests by descending interval width, then route owner ID.
3. Choose the first lane where no different owner interval overlaps or touches.
4. Set lane y to `parentGenerationBottom + routeSubgrid * (laneIndex + 2)`.
5. Increase the generation gap when the final lane would collide with child card clearance.
6. Emit one source stem, one bus, and one child drop per route owner; a one-child family omits the horizontal bus.
7. Store all vertical occupancy. If a different owner overlaps the same x, shift the later vertical segment by one 8px subgrid and add a short horizontal terminal stub.
8. Detect perpendicular crossings and replace the selected horizontal segment portion with a `bridge` segment.
9. If no legal lane exists after expanding the generation gap to fit all route requests, omit that owner and return `UNROUTABLE_PRIMARY_EDGE` in the result diagnostics.

Never merge arrays or SVG paths from different route owners.

- [ ] **Step 4: Implement scene validation**

`validateScene` must return diagnostics for:

- card-card overlap,
- unit-unit overlap,
- route-obstacle intersection outside own terminal segments,
- cross-owner collinear overlap,
- cross-owner false T-junction,
- route endpoints not matching a hub or card port.

Sort diagnostics by code, then joined IDs, so snapshots remain deterministic.

- [ ] **Step 5: Run and commit**

```bash
npm test -- src/core/family-layout/routeFamilyLanes.test.ts src/core/family-layout/validateScene.test.ts
npm run typecheck
git add src/core/family-layout
git commit -m "feat: route collision-free family lanes"
```

---

### Task 7: Pure Layout Orchestration And Public Core Tests

**Files:**
- Create: `src/core/family-layout/layoutFamilyScene.ts`
- Create: `src/core/family-layout/layoutFamilyScene.test.ts`
- Create: `src/core/family-layout/buildSafeFallbackScene.ts`
- Create: `src/core/family-layout/buildSafeFallbackScene.test.ts`
- Modify: `src/core/family-layout/types.ts`

**Interfaces:**
- Consumes: every core-stage interface from Tasks 1–6.
- Produces: `layoutFamilyScene(request: LayoutRequest): LayoutScene`.

- [ ] **Step 1: Write failing orchestration tests**

Tests must cover empty input, a three-generation family, two disconnected families, multiple cross marriages, deterministic repeated output, and safe cycle degradation.

Use exact deterministic assertion:

```ts
const first = layoutFamilyScene(request)
const second = layoutFamilyScene(structuredClone(request))
expect(JSON.stringify(second)).toBe(JSON.stringify(first))
```

Run:

```bash
npm test -- src/core/family-layout/layoutFamilyScene.test.ts
```

Expected: FAIL because the orchestration module is missing.

- [ ] **Step 2: Implement and test the safe fallback scene**

`buildSafeFallbackScene(units, parentageGroups, metrics, diagnostics)` must place units by generation, sorted by stable ID, with one `familyGap` between units and one `generationGap` between rows. It must emit cards and hubs using the same internal family geometry as `compactGrid`, emit no routes, preserve all input diagnostics, and add `UNROUTABLE_PRIMARY_EDGE` for each parentage owner omitted from the fallback. Add a test proving malformed cyclic input still renders every person exactly once with no card overlap.

- [ ] **Step 3: Implement orchestration only**

`layoutFamilyScene.ts` must call stages in this order and contain no geometry algorithms:

```ts
export function layoutFamilyScene(request: LayoutRequest): LayoutScene {
  const projected = projectView(request.facts, request.view)
  const built = buildFamilyUnits(projected, request.preferences, request.metrics)
  const generations = assignGenerations(projected, built)
  const units = built.units.map(unit => ({
    ...unit,
    generation: generations.generationByUnitId[unit.id] ?? 0,
  }))
  const clusters = clusterLineages(projected, units, built.parentageGroups)
  const rows = orderUnits({
    units,
    parentageGroups: built.parentageGroups,
    clusters,
    preferences: request.preferences,
    previousScene: request.previousScene,
    changedIds: request.changedIds,
  })
  const geometry = compactGrid({
    units,
    rows,
    parentageGroups: built.parentageGroups,
    metrics: request.metrics,
    previousScene: request.previousScene,
    changedIds: request.changedIds,
  })
  const routing = routeFamilyLanes({
    geometry,
    units,
    parentageGroups: built.parentageGroups,
    metrics: request.metrics,
  })
  const scene: LayoutScene = {
    units: geometry.units,
    cards: geometry.cards,
    hubs: geometry.hubs,
    rows: geometry.rows,
    routes: routing.routes,
    bounds: geometry.bounds,
    diagnostics: [
      ...request.inputDiagnostics,
      ...projected.diagnostics,
      ...generations.diagnostics,
      ...routing.diagnostics,
    ],
  }
  scene.diagnostics.push(...validateScene(scene, request.metrics))
  scene.diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.ids.join('+').localeCompare(b.ids.join('+')))
  const unsafeCodes = new Set([
    'NODE_OVERLAP',
    'CROSS_FAMILY_SEGMENT_OVERLAP',
    'UNROUTABLE_PRIMARY_EDGE',
  ])
  if (scene.diagnostics.some(diagnostic => unsafeCodes.has(diagnostic.code))) {
    return buildSafeFallbackScene(units, built.parentageGroups, request.metrics, scene.diagnostics)
  }
  return scene
}
```

- [ ] **Step 4: Run all new core tests and commit**

```bash
npm test -- src/core/family-layout
npm run typecheck
git add src/core/family-layout
git commit -m "feat: compose family unit layout scene"
```

---

### Task 8: Schema V3, Preference Migration, And Store Actions

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/migrate.ts`
- Modify: `src/core/migrate.test.ts`
- Create: `src/core/family-layout/reconcilePreferences.ts`
- Create: `src/core/family-layout/reconcilePreferences.test.ts`
- Modify: `src/stores/family.ts`
- Modify: `src/stores/family.test.ts`

**Interfaces:**
- Consumes: V2 `childLayoutAssignments`, `gridLayoutOverrides`, normalized facts, and current family-unit generation data.
- Produces: schema V3 `layoutPreferences`, `setRowOrderPreference`, and `setFamilyAccentAssignment`.

- [ ] **Step 1: Write failing schema and migration tests**

Add tests that expect:

```ts
expect(SCHEMA_VERSION).toBe(3)
expect(migrated.layoutPreferences.familyAccentAssignments).toEqual({})
expect(migrated.layoutPreferences.rowOrders[0].unitIds).toEqual([
  'unit:person:b',
  'unit:person:a',
])
expect(migrated.manualPositions).toEqual(raw.manualPositions)
expect(migrated.gridLayoutOverrides).toEqual(raw.gridLayoutOverrides)
```

Use two isolated same-generation people with V2 orders `b: -1`, `a: 0`.

Run:

```bash
npm test -- src/core/migrate.test.ts src/stores/family.test.ts src/core/family-layout/reconcilePreferences.test.ts
```

Expected: FAIL because schema version 3 and preference helpers do not exist.

- [ ] **Step 2: Add schema V3 preferences**

Add to `schema.ts`:

```ts
export const RowOrderPreference = z.object({
  id: z.string(),
  unitIds: z.array(z.string()),
})
export const PersistedLayoutPreferences = z.object({
  rowOrders: z.array(RowOrderPreference).default([]),
  familyAccentAssignments: z.record(z.string(), z.string()).default({}),
})
export type PersistedLayoutPreferences = z.infer<typeof PersistedLayoutPreferences>
```

Set `SCHEMA_VERSION = 3`, add `layoutPreferences: PersistedLayoutPreferences.default({})` to `FamilyData`, and return empty preferences from `createEmptyFamily()`.

- [ ] **Step 3: Implement V2 preference conversion**

Create `convertLegacyGridPreferences(data)` in `reconcilePreferences.ts`:

1. Normalize facts and build default family units with empty V3 preferences.
2. Assign generations.
3. Translate V2 slot IDs to new unit IDs by member membership.
4. Group translated overrides by generation.
5. Sort each row by numeric V2 order then unit ID.
6. Emit `row:v2:<generation>` IDs.
7. Preserve old V2 fields unchanged.

Add `migrateV2ToV3` in `migrate.ts`, call the conversion, set `layoutPreferences`, and advance to schema 3.

- [ ] **Step 4: Add store actions**

Add exact actions:

```ts
function setRowOrderPreference(id: string, unitIds: string[]) {
  const uniqueIds = [...new Set(unitIds)]
  const index = data.value.layoutPreferences.rowOrders.findIndex(row => row.id === id)
  const next = { id, unitIds: uniqueIds }
  if (index >= 0) data.value.layoutPreferences.rowOrders[index] = next
  else data.value.layoutPreferences.rowOrders.push(next)
  markDirty()
}

function setFamilyAccentAssignment(unitId: string, accent: string | null) {
  if (accent === null) delete data.value.layoutPreferences.familyAccentAssignments[unitId]
  else data.value.layoutPreferences.familyAccentAssignments[unitId] = accent
  markDirty()
}
```

Export both actions. Keep old setters for compatibility, but new UI code must not call them.

- [ ] **Step 5: Run and commit**

```bash
npm test -- src/core/migrate.test.ts src/stores/family.test.ts src/core/family-layout/reconcilePreferences.test.ts
npm run typecheck
git add src/core/schema.ts src/core/migrate.ts src/core/migrate.test.ts src/core/family-layout/reconcilePreferences.ts src/core/family-layout/reconcilePreferences.test.ts src/stores/family.ts src/stores/family.test.ts
git commit -m "feat: migrate semantic layout preferences"
```

---

### Task 9: Public Facade And Family-Unit Rendering

**Files:**
- Modify: `src/core/treeLayout.ts`
- Modify: `src/core/treeLayout.test.ts`
- Create: `src/components/tree/FamilyUnit.vue`
- Create: `src/components/tree/RelationLayer.vue`
- Create: `src/components/tree/GridBackground.vue`
- Modify: `src/components/tree/MemberNode.vue`
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/pages/TreeView.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

**Interfaces:**
- Consumes: `FamilyData`, new layout preferences, and `layoutFamilyScene`.
- Produces: `layoutFamilyTree(members, options): Promise<LayoutScene>` and the user-visible soft family card with exact route rendering.

- [ ] **Step 1: Rewrite public facade tests for `LayoutScene`**

Replace coordinate-cell assertions with scene invariants:

```ts
const scene = await layoutFamilyTree(members)
expect(scene.cards.map(card => card.id).sort()).toEqual(members.map(member => member.id).sort())
expect(scene.units.filter(unit => unit.kind === 'couple')).toHaveLength(3)
expect(scene.diagnostics.filter(value => value.code === 'NODE_OVERLAP')).toEqual([])
expect(scene.diagnostics.filter(value => value.code === 'CROSS_FAMILY_SEGMENT_OVERLAP')).toEqual([])
```

Run `npm test -- src/core/treeLayout.test.ts`; expected FAIL until the facade switches.

- [ ] **Step 2: Switch `treeLayout.ts` to the new engine**

Define options:

```ts
export interface LayoutFamilyTreeOptions {
  data?: FamilyData
  view?: Partial<FamilyViewPolicy>
  previousScene?: LayoutScene
  changedIds?: string[]
}
```

When `data` is absent, create a temporary family from the member list. Normalize facts, merge default view flags, convert persisted preferences to core `LayoutPreferences`, pass `normalizeFacts(...).diagnostics` as `inputDiagnostics`, and call `layoutFamilyScene`. Translate each legacy `childLayoutAssignments[childId].primaryParentId` to the normalized parentage containing that parent and child; `primarySpouseId` must not manufacture a false parent fact. Keep the function async to preserve component request sequencing.

- [ ] **Step 3: Add family-unit component tests first**

In `FamilyCanvas.test.ts`, mock a scene with one couple unit, two cards, one hub, and one primary route. Assert:

- one `[data-testid="family-unit"]`,
- two `[data-testid="member-node"]`,
- one `[data-testid="union-hub"]`,
- primary SVG path has the family accent,
- the family background contains both cards,
- click still emits the selected member ID.

Run the component test and verify RED because new components do not exist.

- [ ] **Step 4: Implement rendering components**

`FamilyUnit.vue` props:

```ts
defineProps<{
  unit: PlacedFamilyUnit
  cards: PlacedPersonCard[]
  members: Member[]
  hubs: PlacedUnionHub[]
  selectedId?: string | null
  viewpointId?: string | null
  dragOffset?: Point
}>()
```

It must:

- position the unit with one outer absolute transform,
- render the accent at 6% background and 25% border opacity,
- render `MemberNode` at card-local positions,
- render the spouse axis only for couple units,
- emit `unit-drag`, `unit-drop`, `select`, and `open`.

`RelationLayer.vue` receives scene routes and renders one SVG `<g data-route-owner>` per route owner. Render `bridge` segments as curved paths and other segments as straight SVG paths. Never concatenate different route owners into one path.

`GridBackground.vue` renders a 24px CSS grid and has no scene logic.

- [ ] **Step 5: Rewrite `FamilyCanvas.vue` around `LayoutScene`**

Use the new facade with the complete `FamilyData`, render `GridBackground`, `RelationLayer`, and one `FamilyUnit` per scene unit. Calculate canvas bounds from pixel rects directly; remove cell-to-pixel conversion and old `LayoutResult` state.

Preserve request-id stale-result protection and pan/zoom focus behavior.

- [ ] **Step 6: Update `TreeView.vue` and run tests**

Pass `family.data` as a single prop instead of separate manual/grid options. Keep viewpoint and selection props unchanged.

Run:

```bash
npm test -- src/core/treeLayout.test.ts src/__tests__/components/FamilyCanvas.test.ts
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/treeLayout.ts src/core/treeLayout.test.ts src/components/tree src/pages/TreeView.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: render family unit layout scenes"
```

---

### Task 10: Sortable Family Drag And Local Reflow

**Files:**
- Modify: `src/components/tree/FamilyUnit.vue`
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`
- Modify: `src/stores/family.ts`
- Modify: `src/stores/family.test.ts`
- Modify: `src/core/family-layout/reconcilePreferences.ts`
- Modify: `src/core/family-layout/reconcilePreferences.test.ts`

**Interfaces:**
- Consumes: scene row metadata, family-unit bounds, `setRowOrderPreference`, and previous scene.
- Produces: same-generation insertion preview and persisted full-row order.

- [ ] **Step 1: Write failing drag tests**

Test a row with units A, B, C. Drag C over A and assert during preview that A and B receive positive transforms, then drop and assert:

```ts
expect(family.data.layoutPreferences.rowOrders).toContainEqual({
  id: scene.rows[0].id,
  unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
})
expect(family.data.manualPositions).toEqual({})
expect(family.data.gridLayoutOverrides).toEqual({})
```

Also assert a large vertical drag does not change generation or persist a row from another generation.

- [ ] **Step 2: Implement insertion preview**

In `FamilyCanvas.vue`, keep:

```ts
interface FamilyDragState {
  unitId: string
  rowId: string
  sourceIndex: number
  targetIndex: number
  dx: number
  dy: number
}
```

During drag:

1. Divide screen deltas by pan/zoom scale.
2. Reject target rows whose generation differs from the source row.
3. Compare dragged center x to neighbor centers to compute insertion index.
4. Build a preview order with a local `arrayMove` helper.
5. Calculate neighbor transforms from preview slot positions.
6. Keep the dragged unit in an overlay transform and original slot as a translucent placeholder.
7. Fade only routes incident to the dragged unit; leave unrelated routes fixed.

- [ ] **Step 3: Persist drop and request local reflow**

On drop:

- call `setRowOrderPreference(rowId, previewUnitIds)`,
- call the layout facade with `previousScene` and `changedIds` containing the unit's members, direct parent IDs, and direct child IDs,
- clear drag state only after the new scene is ready,
- animate from previous to next unit rects once.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts src/stores/family.test.ts src/core/family-layout/reconcilePreferences.test.ts
npm run typecheck
git add src/components/tree/FamilyUnit.vue src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts src/stores/family.ts src/stores/family.test.ts src/core/family-layout/reconcilePreferences.ts src/core/family-layout/reconcilePreferences.test.ts src/core/family-layout/types.ts src/core/family-layout/layoutFamilyScene.ts
git commit -m "feat: reorder family units with local reflow"
```

---

### Task 11: Auxiliary Relationship Layer

**Files:**
- Create: `src/core/family-layout/routeAuxiliaryEdges.ts`
- Create: `src/core/family-layout/routeAuxiliaryEdges.test.ts`
- Modify: `src/core/family-layout/layoutFamilyScene.ts`
- Modify: `src/stores/ui.ts`
- Modify: `src/pages/TreeView.vue`
- Modify: `src/components/tree/RelationLayer.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`
- Modify: `src/__tests__/components/RelationEditor.test.ts`

**Interfaces:**
- Consumes: projected auxiliary relations, placed cards, unit obstacles, and primary route occupancy.
- Produces: dashed historical/secondary/godparent routes that never modify primary geometry.

- [ ] **Step 1: Write failing auxiliary router tests**

Cover:

- toggling auxiliary visibility does not move any unit or card,
- historical and non-primary current partnership routes use left/right ports and their respective kinds,
- godparent routes do not change generations,
- auxiliary segments do not overlap any primary segment with positive length,
- selecting one member can filter auxiliary relations to that member.

- [ ] **Step 2: Implement auxiliary routing**

Use a Manhattan route on the 8px subgrid:

1. Start from left/right card ports.
2. Expand card and family obstacles by 12px.
3. Treat every primary route segment as occupied.
4. Search deterministic candidate paths in this order: direct side corridor, component top corridor, component bottom corridor, outermost side corridor.
5. Choose the path with fewest bends, then shortest length, then lexicographically smallest point list.
6. Emit separate route owners for every auxiliary relation.

Historical partnership, secondary partnership, and secondary-parent routes use gray dashed lines; godparent routes use purple dashed lines.

- [ ] **Step 3: Add UI state and rendering**

Add `showAuxiliaryRelations` and `setShowAuxiliaryRelations` to `ui.ts`. Add one TreeView toggle labeled `辅助关系`. When off, pass all three view flags as false. When on, display relations for the selected member; if no member is selected, display no auxiliary routes to avoid a 500-person edge cloud.

`RelationLayer.vue` must apply `stroke-dasharray="8 6"` only to non-primary routes.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/core/family-layout/routeAuxiliaryEdges.test.ts src/__tests__/components/FamilyCanvas.test.ts src/__tests__/components/RelationEditor.test.ts
npm run typecheck
git add src/core/family-layout src/stores/ui.ts src/pages/TreeView.vue src/components/tree/RelationLayer.vue src/__tests__/components/FamilyCanvas.test.ts src/__tests__/components/RelationEditor.test.ts
git commit -m "feat: add auxiliary family relationship layer"
```

---

### Task 12: Realistic Fixtures, Performance Gate, Default Cutover, And Legacy Cleanup

**Files:**
- Modify: `src/__tests__/fixtures/families.ts`
- Modify: `src/__tests__/e2e/scenarios/layout-verification.test.ts`
- Create: `src/core/family-layout/layoutPerformance.test.ts`
- Modify: `README.md`
- Modify: `package.json`
- Delete legacy files listed in the File Structure section after verification.

**Interfaces:**
- Consumes: final public `layoutFamilyTree` and all scene validators.
- Produces: regression evidence, 500-member performance evidence, default-only new engine, and updated documentation.

- [ ] **Step 1: Add realistic edge-case fixtures**

Add exported fixtures with stable IDs:

- `crossMarriedSiblingsFamily()`: two A siblings marry two B siblings.
- `denseBridgeFamily()`: three cross partnerships between two blood cores, forcing a supercomponent.
- `pedigreeCollapseFamily()`: one ancestor reachable through two valid paths without a parent cycle.
- `parentageCycleFamily()`: two members reference each other as parent.
- `manySameGenerationFamilies(count: number)`: independent current couples with two children each.
- `largeFamily(seed: number, memberCount: number)`: deterministic 500-member acyclic fixture.

The large generator must use a local seeded linear-congruential generator, attach each new member only to older existing generations, cap children per parentage at four, and use stable `person-0001` IDs.

- [ ] **Step 2: Add public e2e layout invariants**

For every fixture, call public `layoutFamilyTree` and assert:

```ts
expect(scene.diagnostics.filter(diagnostic => [
  'NODE_OVERLAP',
  'CROSS_FAMILY_SEGMENT_OVERLAP',
  'UNROUTABLE_PRIMARY_EDGE',
].includes(diagnostic.code))).toEqual([])
expect(new Set(scene.cards.map(card => card.id)).size).toBe(scene.cards.length)
```

The cycle fixture must instead contain `PARENTAGE_CYCLE` and still render both cards.

- [ ] **Step 3: Add the 500-member performance test and opt-in budget gate**

Create:

```ts
it('lays out 500 members within the agreed budget', async () => {
  const members = Object.values(largeFamily(20260711, 500))
  const startedAt = performance.now()
  const scene = await layoutFamilyTree(members)
  const duration = performance.now() - startedAt
  const enforcedBudget = process.env.FAMILY_LAYOUT_PERF_BUDGET_MS

  expect(scene.cards).toHaveLength(500)
  expect(scene.diagnostics.filter(diagnostic => [
    'NODE_OVERLAP',
    'CROSS_FAMILY_SEGMENT_OVERLAP',
    'UNROUTABLE_PRIMARY_EDGE',
  ].includes(diagnostic.code))).toEqual([])

  if (enforcedBudget) {
    expect(duration).toBeLessThan(Number(enforcedBudget))
  }
})
```

Run the test three times locally and report all three values in the task notes. The product target remains 300ms warm locally and 1000ms in CI, but ordinary correctness runs must not fail solely because of host load. Enforce a budget only in a controlled performance job by setting `FAMILY_LAYOUT_PERF_BUDGET_MS`.

- [ ] **Step 4: Verify no legacy production references remain**

Run:

```bash
rg -n "elkLayout|layoutWithElk|constraintFamilyLayout|gridFamilyLayout|gridFamilyModel|familyGraphModel" src
```

Expected: only legacy test/file paths remain. Then delete the legacy files listed above, remove `elkjs` from `package.json`, and run `npm install` so `package-lock.json` is updated if present.

- [ ] **Step 5: Update README**

Document:

- soft family-unit cards,
- same-generation sortable grid,
- blood-lineage affinity with bridge-band fallback,
- family-owned colored lanes with no cross-family overlap,
- auxiliary relationship toggle,
- `src/core/family-layout` pipeline.

Remove statements that describe ELK or the old strict slot engine as the default.

- [ ] **Step 6: Run full automated verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all tests pass, typecheck passes, build passes, and diff check is clean. A pre-existing Vite chunk-size warning is non-blocking unless its size materially increases.

- [ ] **Step 7: Perform visual QA**

Run the Web build and inspect these exact scenarios at 100%, 75%, and 50% zoom:

- two same-generation families with interleaved children,
- five same-generation families with overlapping child spans,
- cross-married sibling bridge band,
- dense supercomponent,
- drag C before A while neighbors drift,
- auxiliary relations off and selected-member-only on.

For every scenario, confirm zero card overlap, zero dangling endpoints, zero cross-family shared segments, visible bridges at crossings, and one animation after drop.

Then run `npm run tauri:dev` and repeat drag, pan, zoom, and focus checks in the desktop window.

- [ ] **Step 8: Commit final cutover**

```bash
git add README.md package.json package-lock.json src docs/superpowers/specs/2026-07-11-family-unit-grid-layout-design.md
git commit -m "feat: complete family unit grid layout engine"
```

If `package-lock.json` does not exist, omit it from `git add`.

---

## Final Verification Checklist

- [ ] Every primary person renders once.
- [ ] Current couples render and drag as one soft-background family unit.
- [ ] Parent-child routes attach to exact hubs and child ports.
- [ ] Same parentage shares one stem and bus.
- [ ] Different families share no positive-length segment and form no false T-junction.
- [ ] Perpendicular cross-family crossings render a bridge.
- [ ] Cards and units never overlap.
- [ ] Cross-married sibling families enter a bridge band.
- [ ] Dense cross-lineage relationships degrade to a supercomponent.
- [ ] Historical, secondary-parent, and godparent routes stay auxiliary and do not affect ranks.
- [ ] Same-row drag persists a full semantic row order and triggers only local reflow.
- [ ] 500 members render without hard-invariant diagnostics; three measured runs are recorded, with 300ms warm local and 1000ms CI retained as performance targets and an opt-in budget gate available for controlled jobs.
- [ ] Full tests, typecheck, build, diff check, Web visual QA, and Tauri visual QA pass.

# Grid Family Layout Design

## Context

The default family tree layout currently uses a constraint-based layout engine:

- `familyGraphModel.ts` builds person, union, and component semantics from raw `Member[]`.
- `constraintFamilyLayout.ts` assigns generations, positions row units, applies `manualPositions`, and emits existing `LayoutResult` coordinates.
- `FamilyCanvas.vue` renders `LayoutResult` by mapping layout cells to pixels.

This works, but the horizontal axis is still a continuous coordinate system. Manual drag also stores free coordinates, so user edits can break the family semantics that the automatic layout tries to preserve.

The new direction is a stricter grid layout: generations define rows, family/person slots define columns, and manual edits adjust grid intent rather than free coordinates.

## Goals

- Keep the default tree focused on the current family structure, not full relationship history.
- Enforce one current spouse per person.
- Represent each member once in the default tree.
- Let users choose a child's primary layout family or primary parent.
- Preserve non-primary parent relations as data and auxiliary context without letting them dominate the default layout.
- Make drag/drop deterministic by snapping to grid slots.
- Keep the public rendering surface compatible with `LayoutResult` so the canvas can be reused.

## Non-Goals

- Do not build a full household/history graph in this phase.
- Do not support multiple simultaneous current spouses in the default layout.
- Do not duplicate a person card in multiple family units.
- Do not make free-form manual coordinates the default editing model.

## Data Model

### Spouse Semantics

Keep spouse refs as bidirectional relations, but treat `married` as the single current spouse relation:

- A member can have at most one `spouses[]` entry with `type: 'married'`.
- Existing `type: 'divorced'` can remain as historical data, but divorced spouses do not form a default `CoupleSlot`.
- Adding a new current spouse when either side already has one requires a confirmation flow that first removes the old current spouse relation.

Schema decision:

```ts
export const SpouseType = z.enum(['married', 'divorced'])
```

Keep the enum unchanged. In V2, `married` means current spouse and `divorced` means historical spouse. Store actions and migration enforce the single-current-spouse invariant.

### Child Primary Layout Assignment

Add layout assignment metadata to `FamilyData` rather than overloading parent refs:

```ts
export const ChildLayoutAssignment = z.object({
  primaryParentId: z.string().optional(),
  primarySpouseId: z.string().optional(),
})

export const ChildLayoutAssignments = z.record(z.string(), ChildLayoutAssignment)
```

Interpretation:

- Key is `childId`.
- `primaryParentId` is the parent whose family row anchor owns the child in the default layout.
- `primarySpouseId` is optional and identifies the current spouse paired with `primaryParentId` when the child should hang under a couple slot.
- Other recorded parents remain in `parents[]` and `children[]`, but default layout treats them as auxiliary relations.

Default inference:

1. If two recorded parents are current spouses, assign the child to that couple.
2. Else assign to the first valid recorded parent, using stable id ordering as a fallback.
3. User overrides are stored in `childLayoutAssignments`; only explicit overrides may attach a child to a current household that is not formed by the recorded parent pair.

### Grid Overrides

Replace free coordinate intent with grid intent:

```ts
export const GridLayoutOverride = z.object({
  order: z.number(),
})

export const GridLayoutOverrides = z.record(z.string(), GridLayoutOverride)
```

Keys should be stable slot ids, not raw member ids:

- `person:<memberId>` for single person slots.
- `couple:<leftId>+<rightId>` for current couple slots.
- `single-parent:<parentId>` for a parent-owned child group without a current spouse.

The first implementation keeps generation automatic and only persists `order`; cross-generation dragging is out of scope.

## Layout Model

Build a new semantic model beside the current constraint layout:

```text
GridPerson
  member id and generation

GridSlot
  PersonSlot | CoupleSlot | SingleParentSlot

GridChildGroup
  parent slot id
  child ids ordered by birth date then id

GridRow
  generation
  ordered slots
```

Slot rules:

- `CoupleSlot`: exactly two current spouses, rendered adjacent.
- `SingleParentSlot`: one parent with children assigned to that parent and no current spouse owner.
- `PersonSlot`: isolated member or member that does not own a child group in that generation.
- A member appears in only one rendered slot in a row.

Generation rules:

- Parent generation is always less than child generation.
- Current spouses are forced to the same generation.
- Child generation is parent generation + 1 for its primary layout assignment.
- Auxiliary parent relations do not draw connectors in the first grid-layout release and do not determine slot ownership.

Column rules:

- Each row is divided into integer grid slots.
- Couple slots occupy enough width for two person cards plus spouse spacing.
- Sibling groups under the same primary slot stay contiguous.
- Drag/drop updates the row order of slots and snaps to the nearest slot index.

## Rendering

The grid engine should still emit the existing `LayoutResult`:

- Convert `row` to `top` using the existing row height.
- Convert slot columns to `cx` in cell units.
- Build `couples` from current spouse slots.
- Build parent-child connectors from primary child groups.
- Do not emit auxiliary parent connectors in the first grid-layout release.

This lets `FamilyCanvas.vue` continue rendering nodes and SVG lines without a full rewrite.

## Interaction

### Adding Current Spouse

When adding spouse relation:

1. Check both members for existing `married` spouse refs.
2. If neither has a conflict, add the bidirectional current spouse relation.
3. If there is a conflict, show a confirmation that names the existing spouse relation(s).
4. On confirm, remove conflicting current spouse refs and add the new one.
5. On cancel, make no data changes.

### Assigning Child Layout Owner

Relation editing should expose a child's primary layout owner when the child has more than one parent relation or when the inferred assignment is not desired.

UI placement:

- Add a select control inside the child/member relation panel in `RelationEditor.vue`.
- Options are valid parents and current spouse pairs involving those parents.
- Default option is "Automatic".

### Dragging

Drag/drop in the default layout no longer writes `{ cx, top }`.

Instead:

- Determine the dragged member's owning slot.
- Determine the target row from the original generation; cross-row moves are rejected or ignored.
- Snap to the nearest column index in that row.
- Persist an order override for that slot.
- Re-run layout.

## Migration And Compatibility

Raise `SCHEMA_VERSION` when these fields land.

### V1 To V2 Migration

Input fields:

- `members`
- `manualPositions`
- existing spouse refs
- parent/child refs

Migration steps:

1. Preserve all members and relation refs.
2. Normalize spouse conflicts:
   - If a member has multiple `married` spouses, keep one deterministic current spouse and convert the rest to `divorced`.
   - Selection rule: keep the first spouse by stable id ordering.
   - Apply the same normalization symmetrically to both members.
3. Create `childLayoutAssignments`:
   - Use the default inference rules.
   - Do not remove non-primary parent refs.
4. Convert `manualPositions` conservatively:
   - Do not attempt to map arbitrary coordinates to grid order during migration.
   - Preserve the old `manualPositions` field in project data as deprecated compatibility data.
   - Initialize `gridLayoutOverrides` as an empty record.
5. Set `schemaVersion` to 2.

Compatibility behavior:

- The new layout engine should ignore old `manualPositions`.
- V2 UI does not expose old manual-position reset controls; the data remains only to avoid destructive migration.
- If old files contain multiple current spouses, the migration must produce a deterministic valid state, not fail project loading.

## Error Handling

- Missing member refs are ignored during layout and should not crash rendering.
- Invalid child layout assignment falls back to automatic inference.
- Spouse conflict resolution should happen in store actions before data is persisted.
- Layout should emit all valid members even when some relations are inconsistent.
- If a grid override points to a missing slot, ignore the override.

## Testing

Core tests:

- Single current spouse creates one `CoupleSlot`.
- Adding a conflicting current spouse requires conflict handling in store-level tests.
- Multiple legacy `married` spouses migrate to one current spouse.
- Child with two current-spouse parents hangs under that couple.
- Child with non-current parent relation uses `childLayoutAssignments`.
- Sibling groups under the same primary owner remain contiguous.
- Drag/drop order override changes only same-generation slot order.
- Cross-generation drag does not persist.
- Old `manualPositions` no longer affect grid layout.
- Existing layout facade still returns valid `LayoutResult`.

Visual/component tests:

- Couple cards remain adjacent.
- Child cards snap to grid columns.
- Reopening a migrated project renders without errors.
- Relation editor warns before replacing a current spouse.

## Recommended Implementation Path

1. Add V2 schema fields and migration.
2. Add store-level spouse conflict helpers without changing UI yet.
3. Add `GridFamilyModel` builder and tests.
4. Add grid layout engine returning `LayoutResult`.
5. Switch default `layoutFamilyTree` to the grid engine.
6. Replace manual position drag persistence with slot order overrides.
7. Add child primary assignment UI.
8. Add current spouse conflict confirmation UI.

## Decisions For This Spec

- Child primary assignment UI lives in `RelationEditor.vue`.
- Auxiliary parent connectors are not part of the first grid-layout release.
- Old `manualPositions` are preserved as deprecated compatibility data and ignored by the grid layout.

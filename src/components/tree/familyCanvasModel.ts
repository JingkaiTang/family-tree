import { DEFAULT_LAYOUT_METRICS, type LayoutScene, type Point } from '@/core/family-layout/types'
import type { FamilyData, LayoutRowPreferenceBatch, RowOrderPreference } from '@/core/schema'

export interface RowDragState {
  mode: 'root-row' | 'bridge-row'
  unitId: string
  domainId: string
  rowId: string
  generation: number
  sourceIndex: number
  targetIndex: number
  sourceColumn: number
  targetColumn: number
  dx: number
  dy: number
}

export interface RootDomainDragState {
  mode: 'root-domain'
  unitId: string
  domainId: string
  componentId: string
  sourceIndex: number
  targetIndex: number
  dx: number
  dy: number
}

export interface SubtreeDragState {
  mode: 'subtree'
  unitId: string
  unitIds: string[]
  dx: number
  dy: number
}

export type FamilyDragState = RowDragState | RootDomainDragState | SubtreeDragState

export type LayoutPreferenceExpectation =
  | { kind: 'root-row' | 'bridge-row'; id: string; unitIds: string[]; columns?: Record<string, number> }
  | { kind: 'root-domain'; componentId: string; rootIds: string[] }
  | { kind: 'subtree'; batch: LayoutRowPreferenceBatch }

export function buildFamilyCanvasSceneModel(scene: LayoutScene, padding: number) {
  const cardsByUnitId = new Map<string, LayoutScene['cards']>()
  for (const card of scene.cards) {
    const cards = cardsByUnitId.get(card.unitId) ?? []
    cards.push(card)
    cardsByUnitId.set(card.unitId, cards)
  }

  const hubsByUnitId = new Map<string, LayoutScene['hubs']>()
  for (const hub of scene.hubs) {
    const hubs = hubsByUnitId.get(hub.unitId) ?? []
    hubs.push(hub)
    hubsByUnitId.set(hub.unitId, hubs)
  }

  const unitById = new Map(scene.units.map(unit => [unit.id, unit]))
  const domainById = new Map(
    [...scene.rootDomains, ...scene.bridgeDomains].map(domain => [domain.id, domain]),
  )
  const unitIdByPersonId = new Map(scene.cards.map(card => [card.id, card.unitId]))
  const primaryChildUnitIdsBySourceId = new Map<string, string[]>()
  for (const group of scene.primaryParentageGroups ?? []) {
    const childUnitIds = group.childPersonIds.flatMap(personId => {
      const childUnitId = unitIdByPersonId.get(personId)
      return childUnitId === undefined || childUnitId === group.sourceUnitId
        ? []
        : [childUnitId]
    })
    primaryChildUnitIdsBySourceId.set(
      group.sourceUnitId,
      [...new Set(childUnitIds)].sort((left, right) => left.localeCompare(right)),
    )
  }

  return {
    sceneOffset: {
      x: padding - scene.bounds.x,
      y: padding - scene.bounds.y,
    },
    canvasSize: {
      width: Math.max(scene.bounds.width + padding * 2, 600),
      height: Math.max(scene.bounds.height + padding * 2, 400),
    },
    cardsByUnitId,
    hubsByUnitId,
    unitById,
    domainById,
    primaryChildUnitIdsBySourceId,
    rootAccentById: Object.fromEntries(scene.rootDomains.flatMap(domain => (
      domain.rootIds.map(rootId => [rootId, domain.accent])
    ))),
    rootOrder: [...scene.rootDomains]
      .sort((left, right) => left.rect.x - right.rect.x || left.id.localeCompare(right.id))
      .flatMap(domain => domain.rootIds),
  }
}

export type FamilyCanvasSceneModel = ReturnType<typeof buildFamilyCanvasSceneModel>

export function primarySubtreeUnitIds(
  scene: LayoutScene,
  model: FamilyCanvasSceneModel,
  sourceUnitId: string,
): string[] {
  const visited = new Set<string>()
  const queue = [sourceUnitId]
  for (let index = 0; index < queue.length; index += 1) {
    const unitId = queue[index]
    if (visited.has(unitId)) continue
    visited.add(unitId)
    queue.push(...(model.primaryChildUnitIdsBySourceId.get(unitId) ?? []))
  }
  return scene.units.filter(unit => visited.has(unit.id)).map(unit => unit.id)
}

export function closestDomain(scene: LayoutScene, centerX: number) {
  return [...scene.rootDomains, ...scene.bridgeDomains]
    .map(domain => ({
      domain,
      distance: centerX < domain.rect.x
        ? domain.rect.x - centerX
        : centerX > domain.rect.x + domain.rect.width
          ? centerX - domain.rect.x - domain.rect.width
          : 0,
    }))
    .sort((left, right) => (
      left.distance - right.distance
      || Math.abs(left.domain.rect.x + left.domain.rect.width / 2 - centerX)
        - Math.abs(right.domain.rect.x + right.domain.rect.width / 2 - centerX)
      || left.domain.id.localeCompare(right.domain.id)
    ))[0]?.domain
}

export function closestRowInDomain(scene: LayoutScene, domainId: string, centerY: number) {
  return scene.rows
    .filter(row => row.unitIds.some(unitId => (
      scene.units.find(unit => unit.id === unitId)?.domainId === domainId
    )))
    .map(row => {
      const rowUnits = row.unitIds
        .map(unitId => scene.units.find(unit => unit.id === unitId))
        .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
      const rowCenterY = rowUnits.length === 0
        ? Number.POSITIVE_INFINITY
        : rowUnits.reduce((sum, unit) => sum + unit.rect.y + unit.rect.height / 2, 0)
          / rowUnits.length
      return { ...row, distance: Math.abs(rowCenterY - centerY) }
    })
    .sort((left, right) => left.distance - right.distance || left.generation - right.generation)[0]
}

export function rootDomainsForComponent(scene: LayoutScene, componentId: string) {
  return scene.rootDomains
    .filter(domain => domain.componentId === componentId)
    .sort((left, right) => left.rect.x - right.rect.x || left.id.localeCompare(right.id))
}

export function rootInsertionIndex(
  domains: LayoutScene['rootDomains'],
  draggedDomainId: string,
  centerX: number,
): number {
  const remaining = domains.filter(domain => domain.id !== draggedDomainId)
  const index = remaining.findIndex(domain => centerX <= domain.rect.x + domain.rect.width / 2)
  return index < 0 ? remaining.length : index
}

export function unitColumn(unitX: number, domainX: number): number {
  return Math.round(
    (unitX - domainX - DEFAULT_LAYOUT_METRICS.gridSize) / DEFAULT_LAYOUT_METRICS.gridSize,
  )
}

export function columnsAfterDrop(data: FamilyData, state: RowDragState): Record<string, number> {
  const preferences = state.mode === 'root-row'
    ? data.layoutPreferences.rowOrders
    : data.layoutPreferences.bridgeOrders
  const current = preferences.find(value => value.id === state.rowId)
  const columns = { ...(current?.columns ?? {}) }
  if (state.targetIndex === state.sourceIndex) columns[state.unitId] = state.targetColumn
  else delete columns[state.unitId]
  return columns
}

export function insertionIndex(
  scene: LayoutScene,
  unitIds: string[],
  draggedUnitId: string,
  centerX: number,
): number {
  const remainingIds = unitIds.filter(unitId => unitId !== draggedUnitId)
  const index = remainingIds.findIndex(unitId => {
    const unit = scene.units.find(value => value.id === unitId)
    return unit !== undefined && centerX <= unit.rect.x + unit.rect.width / 2
  })
  return index < 0 ? remainingIds.length : index
}

export function previewUnitIds(
  scene: LayoutScene,
  state: FamilyDragState | null,
  canDrop: boolean,
): string[] | null {
  if (!state || state.mode === 'root-domain' || state.mode === 'subtree' || !canDrop) return null
  const row = scene.rows.find(value => value.id === state.rowId)
  return row ? arrayMove(row.unitIds, state.sourceIndex, state.targetIndex) : null
}

export function previewRootIds(
  scene: LayoutScene,
  state: FamilyDragState | null,
  canDrop: boolean,
): string[] | null {
  if (!state || state.mode !== 'root-domain' || !canDrop) return null
  const domains = rootDomainsForComponent(scene, state.componentId)
  const rootIds = domains.map(domain => domain.rootIds[0]).filter(Boolean)
  return arrayMove(rootIds, state.sourceIndex, state.targetIndex)
}

export function previewSubtreeBatch(
  scene: LayoutScene,
  data: FamilyData,
  model: FamilyCanvasSceneModel,
  state: FamilyDragState | null,
  canDrop: boolean,
): LayoutRowPreferenceBatch | null {
  if (!state || state.mode !== 'subtree' || !canDrop) return null
  const movedUnitIds = new Set(state.unitIds)
  const batch: LayoutRowPreferenceBatch = { rowOrders: [], bridgeOrders: [] }

  for (const row of scene.rows) {
    const movedRowUnitIds = row.unitIds.filter(unitId => movedUnitIds.has(unitId))
    if (movedRowUnitIds.length === 0) continue
    const rowUnits = row.unitIds
      .map(unitId => model.unitById.get(unitId))
      .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
    const domain = rowUnits[0] === undefined ? undefined : model.domainById.get(rowUnits[0].domainId)
    if (!domain) continue
    const preferences = domain.kind === 'root'
      ? data.layoutPreferences.rowOrders
      : data.layoutPreferences.bridgeOrders
    const current = preferences.find(value => value.id === row.id)
    const columns = { ...(current?.columns ?? {}) }
    for (const unitId of movedRowUnitIds) {
      const unit = model.unitById.get(unitId)
      if (unit === undefined) continue
      columns[unitId] = Math.max(0, unitColumn(unit.rect.x + state.dx, domain.rect.x))
    }
    const originalIndex = new Map(row.unitIds.map((unitId, index) => [unitId, index]))
    const unitIds = [...row.unitIds].sort((leftId, rightId) => {
      const left = model.unitById.get(leftId)
      const right = model.unitById.get(rightId)
      const leftX = (left?.rect.x ?? 0) + (movedUnitIds.has(leftId) ? state.dx : 0)
      const rightX = (right?.rect.x ?? 0) + (movedUnitIds.has(rightId) ? state.dx : 0)
      return leftX - rightX
        || (originalIndex.get(leftId) ?? 0) - (originalIndex.get(rightId) ?? 0)
        || leftId.localeCompare(rightId)
    })
    const preference: RowOrderPreference = {
      id: row.id,
      domainId: domain.id,
      generation: row.generation,
      unitIds,
      columns,
    }
    if (domain.kind === 'root') batch.rowOrders.push(preference)
    else batch.bridgeOrders.push(preference)
  }

  batch.rowOrders.sort((left, right) => left.id.localeCompare(right.id))
  batch.bridgeOrders.sort((left, right) => left.id.localeCompare(right.id))
  return batch
}

export function previewOffsetByUnitId(
  scene: LayoutScene,
  state: FamilyDragState | null,
  unitOrder: string[] | null,
  rootOrder: string[] | null,
): Record<string, Point> {
  if (!state) return {}
  if (state.mode === 'root-domain') return rootDomainPreviewOffsets(scene, state, rootOrder)
  if (state.mode === 'subtree' || !unitOrder) return {}
  const row = scene.rows.find(value => value.id === state.rowId)
  if (!row) return {}
  const rowUnits = row.unitIds
    .map(unitId => scene.units.find(unit => unit.id === unitId))
    .filter((unit): unit is LayoutScene['units'][number] => unit !== undefined)
  const rowGap = rowUnits.slice(1).reduce<number | null>((minimum, unit, index) => {
    const previous = rowUnits[index]
    const gap = unit.rect.x - previous.rect.x - previous.rect.width
    if (gap < 0) return minimum
    return minimum === null ? gap : Math.min(minimum, gap)
  }, null) ?? DEFAULT_LAYOUT_METRICS.familyGap
  let nextX = Math.min(...rowUnits.map(unit => unit.rect.x))
  const previewXByUnitId = new Map<string, number>()
  for (const unitId of unitOrder) {
    const unit = scene.units.find(value => value.id === unitId)
    if (!unit) continue
    previewXByUnitId.set(unitId, nextX)
    nextX += unit.rect.width + rowGap
  }
  return Object.fromEntries(unitOrder.flatMap(unitId => {
    if (unitId === state.unitId) return []
    const unit = scene.units.find(value => value.id === unitId)
    const previewX = previewXByUnitId.get(unitId)
    return unit && previewX !== undefined
      ? [[unitId, { x: previewX - unit.rect.x, y: 0 }]]
      : []
  }))
}

export function dragOffsetForUnit(
  state: FamilyDragState | null,
  unit: LayoutScene['units'][number],
): Point | undefined {
  if (state === null) return undefined
  if (state.mode === 'root-domain') {
    return unit.domainId === state.domainId
      ? { x: state.dx, y: Math.max(-24, Math.min(24, state.dy)) }
      : undefined
  }
  if (state.mode === 'subtree') {
    return state.unitIds.includes(unit.id)
      ? { x: state.dx, y: Math.max(-24, Math.min(24, state.dy)) }
      : undefined
  }
  return state.unitId === unit.id ? { x: state.dx, y: state.dy } : undefined
}

export function isUnitDragging(
  state: FamilyDragState | null,
  unit: LayoutScene['units'][number],
): boolean {
  return state?.mode === 'root-domain'
    ? unit.domainId === state.domainId
    : state?.mode === 'subtree'
      ? state.unitIds.includes(unit.id)
      : state?.unitId === unit.id
}

export function fadedRouteIds(scene: LayoutScene, state: FamilyDragState | null): string[] {
  if (!state) return []
  const unitIds = new Set(
    state.mode === 'root-domain'
      ? scene.units.filter(unit => unit.domainId === state.domainId).map(unit => unit.id)
      : state.mode === 'subtree' ? state.unitIds : [state.unitId],
  )
  const contacts = [
    ...scene.hubs.filter(hub => unitIds.has(hub.unitId)).map(hub => hub.point),
    ...scene.cards.filter(card => unitIds.has(card.unitId)).map(card => ({
      x: card.rect.x + card.rect.width / 2,
      y: card.rect.y,
    })),
  ]
  return scene.routes.flatMap(route => (
    route.segments.some(segment => {
      const endpoints = [segment.points[0], segment.points.at(-1)]
      return endpoints.some(point => point && contacts.some(contact => (
        Math.abs(point.x - contact.x) < 0.5 && Math.abs(point.y - contact.y) < 0.5
      )))
    }) ? [route.id] : []
  ))
}

export function affectedMemberIds(data: FamilyData, memberIds: string[]): string[] {
  const ids = new Set(memberIds)
  const unitMemberIds = new Set(memberIds)
  for (const memberId of memberIds) {
    const member = data.members[memberId]
    if (!member) continue
    for (const parent of member.parents) ids.add(parent.id)
    for (const child of member.children) ids.add(child.id)
  }
  for (const member of Object.values(data.members)) {
    if (
      member.parents.some(parent => unitMemberIds.has(parent.id))
      || member.children.some(child => unitMemberIds.has(child.id))
    ) ids.add(member.id)
  }
  return [...ids].sort((left, right) => left.localeCompare(right))
}

export function hasExpectedLayoutPreference(
  data: FamilyData,
  expected: LayoutPreferenceExpectation,
): boolean {
  if (expected.kind === 'root-domain') {
    const rootOrder = data.layoutPreferences.rootOrders.find(value => (
      value.componentId === expected.componentId
    ))
    return equalOrder(rootOrder?.rootIds, expected.rootIds)
  }
  if (expected.kind === 'subtree') {
    return expected.batch.rowOrders.every(preference => (
      hasRowPreference(data.layoutPreferences.rowOrders, preference)
    )) && expected.batch.bridgeOrders.every(preference => (
      hasRowPreference(data.layoutPreferences.bridgeOrders, preference)
    ))
  }
  const rows = expected.kind === 'root-row'
    ? data.layoutPreferences.rowOrders
    : data.layoutPreferences.bridgeOrders
  const row = rows.find(value => value.id === expected.id)
  return equalOrder(row?.unitIds, expected.unitIds)
    && equalColumns(row?.columns, expected.columns)
}

function hasRowPreference(preferences: RowOrderPreference[], expected: RowOrderPreference): boolean {
  const current = preferences.find(value => value.id === expected.id)
  return equalOrder(current?.unitIds, expected.unitIds)
    && equalColumns(current?.columns, expected.columns)
}

function rootDomainPreviewOffsets(
  scene: LayoutScene,
  state: RootDomainDragState,
  rootIds: string[] | null,
): Record<string, Point> {
  if (rootIds === null) return {}
  const domains = rootDomainsForComponent(scene, state.componentId)
  const domainByRootId = new Map(domains.flatMap(domain => (
    domain.rootIds[0] ? [[domain.rootIds[0], domain] as const] : []
  )))
  const slotXs = domains.map(domain => domain.rect.x)
  const targetXByRootId = new Map<string, number>()
  let nextX = slotXs[0] ?? 0
  rootIds.forEach((rootId, index) => {
    const domain = domainByRootId.get(rootId)
    if (domain === undefined) return
    const targetX = Math.max(slotXs[index] ?? nextX, nextX)
    targetXByRootId.set(rootId, targetX)
    nextX = targetX + domain.rect.width + DEFAULT_LAYOUT_METRICS.rootGap
  })
  const offsetByDomainId = new Map<string, number>()
  for (const [rootId, domain] of domainByRootId) {
    if (domain.id === state.domainId) continue
    const targetX = targetXByRootId.get(rootId)
    if (targetX !== undefined) offsetByDomainId.set(domain.id, targetX - domain.rect.x)
  }
  for (const bridge of scene.bridgeDomains.filter(value => value.componentId === state.componentId)) {
    const offsets = bridge.rootIds.flatMap(rootId => {
      const domain = domainByRootId.get(rootId)
      const targetX = targetXByRootId.get(rootId)
      return domain === undefined || targetX === undefined ? [] : [targetX - domain.rect.x]
    })
    if (offsets.length > 0) {
      offsetByDomainId.set(
        bridge.id,
        offsets.reduce((sum, value) => sum + value, 0) / offsets.length,
      )
    }
  }
  return Object.fromEntries(scene.units.flatMap(unit => {
    const offset = offsetByDomainId.get(unit.domainId)
    return offset === undefined ? [] : [[unit.id, { x: offset, y: 0 }]]
  }))
}

function arrayMove<T>(values: T[], from: number, to: number): T[] {
  const result = [...values]
  const [value] = result.splice(from, 1)
  if (value === undefined) return result
  result.splice(to, 0, value)
  return result
}

function equalOrder(left: string[] | undefined, right: string[]): boolean {
  return left?.length === right.length
    && left.every((value, index) => value === right[index])
}

function equalColumns(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([unitId, column], index) => (
      unitId === rightEntries[index]?.[0] && column === rightEntries[index]?.[1]
    ))
}

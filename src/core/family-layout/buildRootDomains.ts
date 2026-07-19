import { rootSignatureKey } from './rootSignatures'
import type {
  BuildRootDomainsInput,
  BuildRootDomainsResult,
  FamilyUnit,
  LayoutDiagnostic,
  LayoutDomain,
  RootFamily,
  RootInteractionEdge,
  RootSignature,
} from './types'

interface InteractionComponent {
  rootIds: string[]
  edgeIds: string[]
  unitIds: string[]
  kind: 'pair-bridge' | 'multi-root-island'
  domainId: string
}

export function buildRootDomains(
  input: BuildRootDomainsInput,
): BuildRootDomainsResult {
  const units = [...input.units].sort((left, right) => left.id.localeCompare(right.id))
  const roots = [...input.roots].sort((left, right) => left.id.localeCompare(right.id))
  const rootById = new Map(roots.map(root => [root.id, root]))
  const interactionEdges = buildInteractionEdges(units, input)
  const interactionComponents = buildInteractionComponents(
    roots.map(root => root.id),
    interactionEdges,
    units,
    input.signatures.signatureByUnitId,
  )
  const componentByRootId = new Map(
    interactionComponents.flatMap(component => (
      component.rootIds.map(rootId => [rootId, component] as const)
    )),
  )
  const rootOrder = buildStableRootOrder(input, interactionEdges)
  const rootPositionById = new Map(
    rootOrder.map((rootId, index) => [rootId, index]),
  )
  const domainIdByUnitId: Record<string, string> = {}
  const diagnostics: LayoutDiagnostic[] = []

  for (const unit of units) {
    const signature = input.signatures.signatureByUnitId[unit.id] ?? []
    const domainId = resolveDomainId(signature, componentByRootId, rootById)
    if (domainId === undefined) {
      diagnostics.push(invalidAssignmentDiagnostic(unit.id, signature))
      continue
    }
    domainIdByUnitId[unit.id] = domainId
  }

  const unorderedDomains = [
    ...roots.map(root => createRootDomain(
      root,
      units,
      domainIdByUnitId,
      input.accents,
    )),
    ...interactionComponents.map(component => createBridgeDomain(
      component,
      units,
      domainIdByUnitId,
      rootById,
      rootPositionById,
      input,
      input.accents,
    )),
  ]
  const domains = orderDomains(
    unorderedDomains,
    rootOrder,
    rootPositionById,
  ).map((domain, order) => ({ ...domain, order }))

  if (Object.keys(domainIdByUnitId).length !== units.length) {
    const missingUnitIds = units
      .map(unit => unit.id)
      .filter(unitId => domainIdByUnitId[unitId] === undefined)
    if (missingUnitIds.length > 0 && diagnostics.length === 0) {
      diagnostics.push(invalidAssignmentDiagnostic(missingUnitIds[0], []))
    }
  }

  return {
    domains,
    domainIdByUnitId,
    rootOrder,
    interactionEdges,
    diagnostics: diagnostics.sort((left, right) => (
      left.ids.join('|').localeCompare(right.ids.join('|'))
    )),
  }
}

function buildInteractionEdges(
  units: FamilyUnit[],
  input: BuildRootDomainsInput,
): RootInteractionEdge[] {
  const edgeById = new Map<string, RootInteractionEdge>()
  for (const unit of units) {
    const signature = input.signatures.signatureByUnitId[unit.id] ?? []
    if (signature.length < 2) continue
    const rootIds = [...new Set(signature)].sort((left, right) => (
      left.localeCompare(right)
    ))
    const weight = interactionWeight(unit, input)
    for (let leftIndex = 0; leftIndex < rootIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < rootIds.length;
        rightIndex += 1
      ) {
        const leftRootId = rootIds[leftIndex]
        const rightRootId = rootIds[rightIndex]
        const id = `interaction:${leftRootId}|${rightRootId}`
        const current = edgeById.get(id) ?? {
          id,
          leftRootId,
          rightRootId,
          weight: 0,
          unitIds: [],
        }
        current.weight += weight
        if (!current.unitIds.includes(unit.id)) current.unitIds.push(unit.id)
        current.unitIds.sort((left, right) => left.localeCompare(right))
        edgeById.set(id, current)
      }
    }
  }
  return [...edgeById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function interactionWeight(
  unit: FamilyUnit,
  input: BuildRootDomainsInput,
): number {
  const uniqueMemberRootIds = new Set(
    unit.memberIds
      .map(personId => input.signatures.sourceRootIdByPersonId[personId])
      .filter((rootId): rootId is string => rootId !== undefined),
  )
  if (unit.kind === 'couple' && uniqueMemberRootIds.size > 1) return 4
  if (unit.memberIds.every(personId => (
    (input.signatures.signatureByPersonId[personId]?.length ?? 0) > 1
  ))) return 2
  return 1
}

function buildInteractionComponents(
  rootIds: string[],
  edges: RootInteractionEdge[],
  units: FamilyUnit[],
  signatureByUnitId: Record<string, RootSignature>,
): InteractionComponent[] {
  const adjacentRootIds = new Map(
    rootIds.map(rootId => [rootId, new Set<string>()]),
  )
  for (const edge of edges) {
    adjacentRootIds.get(edge.leftRootId)?.add(edge.rightRootId)
    adjacentRootIds.get(edge.rightRootId)?.add(edge.leftRootId)
  }

  const visited = new Set<string>()
  const components: InteractionComponent[] = []
  for (const rootId of [...rootIds].sort((left, right) => left.localeCompare(right))) {
    if (visited.has(rootId) || (adjacentRootIds.get(rootId)?.size ?? 0) === 0) continue
    const componentRootIds: string[] = []
    const pending = [rootId]
    visited.add(rootId)
    while (pending.length > 0) {
      const currentId = pending.pop()
      if (currentId === undefined) break
      componentRootIds.push(currentId)
      for (const adjacentId of [...(adjacentRootIds.get(currentId) ?? [])]
        .sort((left, right) => right.localeCompare(left))) {
        if (visited.has(adjacentId)) continue
        visited.add(adjacentId)
        pending.push(adjacentId)
      }
    }
    componentRootIds.sort((left, right) => left.localeCompare(right))
    const rootSet = new Set(componentRootIds)
    const componentEdges = edges.filter(edge => (
      rootSet.has(edge.leftRootId) && rootSet.has(edge.rightRootId)
    ))
    const unitIds = units
      .filter(unit => {
        const signature = signatureByUnitId[unit.id] ?? []
        return signature.length > 1 && signature.some(value => rootSet.has(value))
      })
      .map(unit => unit.id)
      .sort((left, right) => left.localeCompare(right))
    const containsMultiRootSignature = unitIds.some(unitId => (
      (signatureByUnitId[unitId]?.length ?? 0) > 2
    ))
    const isSparsePair = componentRootIds.length === 2
      && componentEdges.length === 1
      && unitIds.length <= 3
      && !containsMultiRootSignature
    const kind = isSparsePair ? 'pair-bridge' : 'multi-root-island'
    const signatureKey = componentRootIds.join('|')
    components.push({
      rootIds: componentRootIds,
      edgeIds: componentEdges.map(edge => edge.id),
      unitIds,
      kind,
      domainId: kind === 'pair-bridge'
        ? `domain:bridge:${signatureKey}`
        : `domain:island:${signatureKey}`,
    })

  }
  return components.sort((left, right) => left.domainId.localeCompare(right.domainId))
}

function buildStableRootOrder(
  input: BuildRootDomainsInput,
  edges: RootInteractionEdge[],
): string[] {
  const rootsByComponentId = new Map<string, RootFamily[]>()
  for (const root of input.roots) {
    const roots = rootsByComponentId.get(root.componentId) ?? []
    roots.push(root)
    rootsByComponentId.set(root.componentId, roots)
  }
  const preferredComponentId = input.preferredComponentPersonId === undefined
    ? undefined
    : input.signatures.signatureByPersonId[input.preferredComponentPersonId]
      ?.map(rootId => input.roots.find(root => root.id === rootId)?.componentId)
      .find((componentId): componentId is string => componentId !== undefined)
  const previousXByRootId = previousRootX(input)
  const componentIds = [...rootsByComponentId.keys()].sort((left, right) => {
    if (left === preferredComponentId && right !== preferredComponentId) return -1
    if (right === preferredComponentId && left !== preferredComponentId) return 1
    const leftX = minimumPreviousX(rootsByComponentId.get(left) ?? [], previousXByRootId)
    const rightX = minimumPreviousX(rootsByComponentId.get(right) ?? [], previousXByRootId)
    return leftX - rightX || left.localeCompare(right)
  })

  const stableOrder = componentIds.flatMap(componentId => {
    const roots = rootsByComponentId.get(componentId) ?? []
    const preferredRootIds = input.preferences.rootOrders
      .find(preference => preference.componentId === componentId)
      ?.rootIds.filter(rootId => roots.some(root => root.id === rootId)) ?? []
    const preferredIndex = new Map(
      preferredRootIds.map((rootId, index) => [rootId, index]),
    )
    const seed = roots.map(root => root.id).sort((left, right) => {
      const leftPreference = preferredIndex.get(left)
      const rightPreference = preferredIndex.get(right)
      if (leftPreference !== undefined || rightPreference !== undefined) {
        if (leftPreference === undefined) return 1
        if (rightPreference === undefined) return -1
        if (leftPreference !== rightPreference) return leftPreference - rightPreference
      }
      const leftX = previousXByRootId.get(left) ?? Number.POSITIVE_INFINITY
      const rightX = previousXByRootId.get(right) ?? Number.POSITIVE_INFINITY
      return leftX - rightX || left.localeCompare(right)
    })
    return optimizeRootOrder(seed, edges, preferredRootIds)
  })
  return applySiblingRootOrders(stableOrder, input.roots, input.siblingOrders ?? {})
}

function applySiblingRootOrders(
  rootIds: string[],
  roots: RootFamily[],
  siblingOrders: Readonly<Record<string, string[]>>,
): string[] {
  let result = [...rootIds]
  const rootIdByPersonId = new Map(roots.flatMap(root => (
    root.seedPersonIds.map(personId => [personId, root.id] as const)
  )))

  for (const [, personIds] of Object.entries(siblingOrders)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const orderedRootIds = [...new Set(personIds
      .map(personId => rootIdByPersonId.get(personId))
      .filter((rootId): rootId is string => rootId !== undefined))]
      .filter(rootId => result.includes(rootId))
    if (orderedRootIds.length < 2) continue
    const siblingRootSet = new Set(orderedRootIds)
    const firstIndex = Math.min(...orderedRootIds.map(rootId => result.indexOf(rootId)))
    result = result.filter(rootId => !siblingRootSet.has(rootId))
    result.splice(firstIndex, 0, ...orderedRootIds)
  }
  return result
}

function optimizeRootOrder(
  seed: string[],
  edges: RootInteractionEdge[],
  preferredRootIds: string[],
): string[] {
  const order = [...seed]
  const maximumPasses = order.length * order.length
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let improved = false
    for (let index = 0; index < order.length - 1; index += 1) {
      const candidate = [...order]
      ;[candidate[index], candidate[index + 1]] = [
        candidate[index + 1],
        candidate[index],
      ]
      if (!preservesPreferredOrder(candidate, preferredRootIds)) continue
      if (rootOrderCost(candidate, edges) >= rootOrderCost(order, edges)) continue
      order.splice(0, order.length, ...candidate)
      improved = true
    }
    if (!improved) break
  }
  return order
}

function preservesPreferredOrder(order: string[], preferredRootIds: string[]): boolean {
  const preferredSet = new Set(preferredRootIds)
  return order.filter(rootId => preferredSet.has(rootId))
    .every((rootId, index) => rootId === preferredRootIds[index])
}

function rootOrderCost(order: string[], edges: RootInteractionEdge[]): number {
  const positionByRootId = new Map(order.map((rootId, index) => [rootId, index]))
  return edges.reduce((cost, edge) => {
    const left = positionByRootId.get(edge.leftRootId)
    const right = positionByRootId.get(edge.rightRootId)
    return left === undefined || right === undefined
      ? cost
      : cost + Math.abs(left - right) * edge.weight
  }, 0)
}

function previousRootX(input: BuildRootDomainsInput): Map<string, number> {
  const previousDomains = input.previousScene?.rootDomains ?? []
  const entries = previousDomains.flatMap(domain => (
    domain.rect === undefined
      ? []
      : domain.rootIds.map(rootId => [rootId, domain.rect?.x ?? 0] as const)
  ))
  const previousXByRootId = new Map(
    entries.sort((left, right) => left[0].localeCompare(right[0])),
  )
  for (const root of [...input.roots].sort((left, right) => (
    left.id.localeCompare(right.id)
  ))) {
    if (previousXByRootId.has(root.id)) continue
    const previousRootId = input.previousRootIdByRootId?.[root.id]
    const previousX = previousRootId === undefined
      ? undefined
      : previousXByRootId.get(previousRootId)
    if (previousX !== undefined) previousXByRootId.set(root.id, previousX)
  }
  return previousXByRootId
}

function minimumPreviousX(
  roots: RootFamily[],
  previousXByRootId: ReadonlyMap<string, number>,
): number {
  return Math.min(
    ...roots.map(root => previousXByRootId.get(root.id) ?? Number.POSITIVE_INFINITY),
  )
}

function resolveDomainId(
  signature: RootSignature,
  componentByRootId: ReadonlyMap<string, InteractionComponent>,
  rootById: ReadonlyMap<string, RootFamily>,
): string | undefined {
  if (signature.length === 1 && rootById.has(signature[0])) {
    return `domain:${signature[0]}`
  }
  if (signature.length < 2) return undefined
  const component = componentByRootId.get(signature[0])
  if (component === undefined) return undefined
  return signature.every(rootId => component.rootIds.includes(rootId))
    ? component.domainId
    : undefined
}

function createRootDomain(
  root: RootFamily,
  units: FamilyUnit[],
  domainIdByUnitId: Record<string, string>,
  accents: Record<string, string>,
): LayoutDomain {
  const id = `domain:${root.id}`
  const domainUnits = units.filter(unit => domainIdByUnitId[unit.id] === id)
  return {
    id,
    kind: 'root',
    componentId: root.componentId,
    rootIds: [root.id],
    signature: [root.id],
    personIds: collectPersonIds(domainUnits),
    unitIds: domainUnits.map(unit => unit.id),
    order: 0,
    accent: accents[root.id] ?? '',
  }
}

function createBridgeDomain(
  component: InteractionComponent,
  units: FamilyUnit[],
  domainIdByUnitId: Record<string, string>,
  rootById: ReadonlyMap<string, RootFamily>,
  rootPositionById: ReadonlyMap<string, number>,
  input: BuildRootDomainsInput,
  accents: Record<string, string>,
): LayoutDomain {
  const domainUnits = orderBridgeUnits(
    units.filter(unit => domainIdByUnitId[unit.id] === component.domainId),
    component.domainId,
    input,
    rootPositionById,
  )
  const spatialRootIds = [...component.rootIds].sort((left, right) => (
    (rootPositionById.get(left) ?? Number.POSITIVE_INFINITY)
    - (rootPositionById.get(right) ?? Number.POSITIVE_INFINITY)
    || left.localeCompare(right)
  ))
  return {
    id: component.domainId,
    kind: component.kind,
    componentId: rootById.get(component.rootIds[0])?.componentId
      ?? `component:${component.rootIds[0]}`,
    rootIds: spatialRootIds,
    signature: [...component.rootIds],
    personIds: collectPersonIds(domainUnits),
    unitIds: domainUnits.map(unit => unit.id),
    order: 0,
    accent: accents[spatialRootIds[0]] ?? '',
  }
}

function orderBridgeUnits(
  units: FamilyUnit[],
  domainId: string,
  input: BuildRootDomainsInput,
  rootPositionById: ReadonlyMap<string, number>,
): FamilyUnit[] {
  const preferenceIndexByRowId = new Map(
    input.preferences.bridgeOrders
      .filter(preference => preference.domainId === domainId)
      .flatMap(preference => preference.unitIds.map((unitId, index) => [
        `${preference.generation}:${unitId}`,
        index,
      ] as const)),
  )
  const barycenter = (unit: FamilyUnit): number => {
    const sourcePositions = unit.memberIds.flatMap(personId => {
      const rootId = input.signatures.sourceRootIdByPersonId[personId]
      const position = rootId === undefined ? undefined : rootPositionById.get(rootId)
      return position === undefined ? [] : [position]
    })
    const fallbackPositions = (input.signatures.signatureByUnitId[unit.id] ?? [])
      .flatMap(rootId => {
        const position = rootPositionById.get(rootId)
        return position === undefined ? [] : [position]
      })
    const positions = sourcePositions.length > 0 ? sourcePositions : fallbackPositions
    return positions.length === 0
      ? Number.POSITIVE_INFINITY
      : positions.reduce((sum, position) => sum + position, 0) / positions.length
  }

  return [...units].sort((left, right) => {
    if (left.generation !== right.generation) {
      return left.generation - right.generation
    }
    const leftPreference = preferenceIndexByRowId.get(
      `${left.generation}:${left.id}`,
    )
    const rightPreference = preferenceIndexByRowId.get(
      `${right.generation}:${right.id}`,
    )
    if (leftPreference !== undefined || rightPreference !== undefined) {
      if (leftPreference === undefined) return 1
      if (rightPreference === undefined) return -1
      if (leftPreference !== rightPreference) return leftPreference - rightPreference
    }
    return barycenter(left) - barycenter(right) || left.id.localeCompare(right.id)
  })
}

function orderDomains(
  domains: LayoutDomain[],
  rootOrder: string[],
  rootPositionById: ReadonlyMap<string, number>,
): LayoutDomain[] {
  const fallbackPosition = rootOrder.length
  const anchor = (domain: LayoutDomain): number => {
    const positions = domain.rootIds
      .map(rootId => rootPositionById.get(rootId))
      .filter((position): position is number => position !== undefined)
    return positions.length === 0
      ? fallbackPosition
      : positions.reduce((sum, position) => sum + position, 0) / positions.length
  }

  return [...domains].sort((left, right) => {
    const anchorDifference = anchor(left) - anchor(right)
    if (anchorDifference !== 0) return anchorDifference
    if (left.kind === 'root' && right.kind !== 'root') return -1
    if (right.kind === 'root' && left.kind !== 'root') return 1
    return left.id.localeCompare(right.id)
  })
}

function collectPersonIds(units: FamilyUnit[]): string[] {
  return [...new Set(units.flatMap(unit => unit.memberIds))]
    .sort((left, right) => left.localeCompare(right))
}

function invalidAssignmentDiagnostic(
  unitId: string,
  signature: RootSignature,
): LayoutDiagnostic {
  return {
    code: 'INVALID_ROOT_DOMAIN_ASSIGNMENT',
    ids: [unitId, rootSignatureKey(signature)].filter(Boolean),
    message: `家庭单位 ${unitId} 无法唯一归属根域或桥接域`,
  }
}

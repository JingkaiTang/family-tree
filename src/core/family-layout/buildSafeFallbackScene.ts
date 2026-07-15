import {
  familyUnitWidth,
  materializeRootSceneGeometry,
} from './materializeSceneGeometry'
import type {
  LayoutDiagnostic,
  LayoutDomain,
  LayoutMetrics,
  ParentageGroup,
  PlacedLayoutDomain,
  PlacedRootedFamilyUnit,
  PlacedRow,
  RootedFamilyUnit,
  RootLayoutScene,
} from './types'

export function buildSafeFallbackScene(
  inputUnits: RootedFamilyUnit[],
  inputDomains: LayoutDomain[],
  parentageGroups: ParentageGroup[],
  metrics: LayoutMetrics,
  diagnostics: LayoutDiagnostic[],
): RootLayoutScene {
  const { units, domains } = reconcileFallbackDomains(inputUnits, inputDomains)
  if (units.length === 0) {
    return {
      ...materializeRootSceneGeometry({
        placedUnits: [],
        placedDomains: [],
        rows: [],
        parentageGroups: [],
        metrics,
      }),
      gateways: [],
      routes: [],
      diagnostics: [...diagnostics].sort(compareDiagnostics),
    }
  }

  const firstGeneration = Math.min(...units.map(unit => unit.generation))
  const rows: Array<PlacedRow & { domainId: string }> = domains.flatMap(domain => {
    const unitsByGeneration = new Map<number, string[]>()
    for (const unit of units.filter(value => value.domainId === domain.id)) {
      const unitIds = unitsByGeneration.get(unit.generation) ?? []
      unitIds.push(unit.id)
      unitsByGeneration.set(unit.generation, unitIds)
    }
    return [...unitsByGeneration]
      .sort(([left], [right]) => left - right)
      .map(([generation, unitIds]) => ({
        id: `row:${domain.id}:${generation}`,
        domainId: domain.id,
        generation,
        unitIds: [...unitIds].sort((left, right) => left.localeCompare(right)),
      }))
  })
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const contentWidthByDomainId = new Map(domains.map(domain => {
    const rowWidths = rows
      .filter(row => row.domainId === domain.id)
      .map(row => row.unitIds.reduce((width, unitId, index) => {
        const unit = unitById.get(unitId)
        return unit === undefined
          ? width
          : width + familyUnitWidth(unit, metrics)
            + (index === 0 ? 0 : metrics.familyGap)
      }, 0))
    return [domain.id, Math.max(metrics.cardWidth, ...rowWidths)] as const
  }))
  const placedDomains: PlacedLayoutDomain[] = []
  let domainX = 0
  for (const [index, domain] of domains.entries()) {
    const previous = domains[index - 1]
    if (previous !== undefined) {
      domainX += previous.kind === 'root' && domain.kind === 'root'
        ? metrics.rootGap
        : metrics.bridgeGap
    }
    const width = snapUp(
      (contentWidthByDomainId.get(domain.id) ?? metrics.cardWidth)
        + metrics.gridSize * 2,
      metrics.gridSize,
    )
    placedDomains.push({
      ...domain,
      rect: { x: domainX, y: 0, width, height: 0 },
      columnStart: domainX / metrics.gridSize,
      columnEnd: (domainX + width) / metrics.gridSize - 1,
    })
    domainX += width
  }
  const domainById = new Map(placedDomains.map(domain => [domain.id, domain]))
  const placedUnits: PlacedRootedFamilyUnit[] = rows.flatMap(row => {
    const domain = domainById.get(row.domainId)
    if (domain === undefined) return []
    let nextX = domain.rect.x + metrics.gridSize
    return row.unitIds.flatMap((unitId, order) => {
      const unit = unitById.get(unitId)
      if (unit === undefined) return []
      const width = familyUnitWidth(unit, metrics)
      const placed: PlacedRootedFamilyUnit = {
        ...unit,
        memberIds: [...unit.memberIds],
        rootSignature: [...unit.rootSignature],
        memberRootIds: { ...unit.memberRootIds },
        rect: {
          x: nextX,
          y: (row.generation - firstGeneration)
            * (metrics.cardHeight + metrics.generationGap),
          width,
          height: metrics.cardHeight,
        },
        order,
      }
      nextX += width + metrics.familyGap
      return [placed]
    })
  })
  const bottom = Math.max(...placedUnits.map(unit => (
    unit.rect.y + unit.rect.height
  )))
  placedDomains.forEach(domain => { domain.rect.height = bottom })
  const geometry = materializeRootSceneGeometry({
    placedUnits,
    placedDomains,
    rows,
    parentageGroups,
    metrics,
  })
  const fallbackDiagnostics = fallbackRouteDiagnostics(
    parentageGroups,
    diagnostics,
  )

  return {
    ...geometry,
    gateways: [],
    routes: [],
    diagnostics: fallbackDiagnostics,
  }
}

function reconcileFallbackDomains(
  inputUnits: RootedFamilyUnit[],
  inputDomains: LayoutDomain[],
): { units: RootedFamilyUnit[]; domains: LayoutDomain[] } {
  const domainById = new Map(
    [...inputDomains]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map(domain => [domain.id, {
        ...domain,
        rootIds: [...domain.rootIds],
        signature: [...domain.signature],
        personIds: [] as string[],
        unitIds: [] as string[],
      }]),
  )
  const units = [...inputUnits]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(unit => {
      const domainId = unit.domainId || `domain:fallback:${unit.id}`
      if (!domainById.has(domainId)) {
        domainById.set(domainId, {
          id: domainId,
          kind: 'root',
          componentId: `component:fallback:${unit.id}`,
          rootIds: [...unit.rootSignature],
          signature: [...unit.rootSignature],
          personIds: [],
          unitIds: [],
          order: domainById.size,
          accent: unit.rootAccent,
        })
      }
      const domain = domainById.get(domainId)!
      domain.unitIds.push(unit.id)
      domain.personIds.push(...unit.memberIds)
      return {
        ...unit,
        domainId,
        memberIds: [...unit.memberIds],
        rootSignature: [...unit.rootSignature],
        memberRootIds: { ...unit.memberRootIds },
      }
    })
  const domains = [...domainById.values()]
    .filter(domain => domain.unitIds.length > 0)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((domain, order) => ({
      ...domain,
      order,
      personIds: [...new Set(domain.personIds)]
        .sort((left, right) => left.localeCompare(right)),
      unitIds: [...new Set(domain.unitIds)]
        .sort((left, right) => left.localeCompare(right)),
    }))
  return { units, domains }
}

function fallbackRouteDiagnostics(
  parentageGroups: ParentageGroup[],
  diagnostics: LayoutDiagnostic[],
): LayoutDiagnostic[] {
  const fallbackDiagnostics = [...diagnostics]
  const alreadyUnroutableOwnerIds = new Set(
    diagnostics
      .filter(value => (
        value.code === 'UNROUTABLE_PRIMARY_EDGE' && value.ids.length === 1
      ))
      .map(value => value.ids[0]),
  )
  for (const group of [...parentageGroups].sort((left, right) => (
    left.id.localeCompare(right.id)
  ))) {
    if (alreadyUnroutableOwnerIds.has(group.id)) continue
    fallbackDiagnostics.push({
      code: 'UNROUTABLE_PRIMARY_EDGE',
      ids: [group.id],
      message: `Primary family edge ${group.id} omitted from safe fallback`,
    })
  }
  return fallbackDiagnostics.sort(compareDiagnostics)
}

function snapUp(value: number, gridSize: number): number {
  return Math.ceil(value / gridSize) * gridSize
}

function compareDiagnostics(
  left: LayoutDiagnostic,
  right: LayoutDiagnostic,
): number {
  return left.code.localeCompare(right.code)
    || left.ids.join('+').localeCompare(right.ids.join('+'))
    || left.message.localeCompare(right.message)
}

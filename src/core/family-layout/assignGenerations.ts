import type { BuiltFamilyUnits } from './buildFamilyUnits'
import type { LayoutDiagnostic, ProjectedFamily } from './types'

export interface GenerationResult {
  generationByUnitId: Record<string, number>
  cyclicUnitIds: string[]
  diagnostics: LayoutDiagnostic[]
}

export function assignGenerations(
  _projected: ProjectedFamily,
  built: BuiltFamilyUnits,
): GenerationResult {
  const unitIds = built.units.map(unit => unit.id).sort((a, b) => a.localeCompare(b))
  const knownUnitIds = new Set(unitIds)
  const outgoing = new Map(unitIds.map(unitId => [unitId, new Set<string>()]))
  const selfEdgeUnitIds = new Set<string>()

  for (const group of built.parentageGroups) {
    if (!knownUnitIds.has(group.sourceUnitId)) continue
    for (const childPersonId of group.childPersonIds) {
      const childUnitId = built.unitIdByPersonId[childPersonId]
      if (childUnitId === undefined || !knownUnitIds.has(childUnitId)) continue
      if (childUnitId === group.sourceUnitId) {
        selfEdgeUnitIds.add(childUnitId)
        continue
      }
      outgoing.get(group.sourceUnitId)?.add(childUnitId)
    }
  }

  const components = findStronglyConnectedComponents(unitIds, outgoing)
    .map(component => component.sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => a[0].localeCompare(b[0]))
  const componentByUnitId = new Map<string, number>()
  components.forEach((component, componentIndex) => {
    component.forEach(unitId => componentByUnitId.set(unitId, componentIndex))
  })

  const cyclicComponents = components.filter(component => (
    component.length > 1 || selfEdgeUnitIds.has(component[0])
  ))
  const cyclicUnitIds = cyclicComponents.flat().sort((a, b) => a.localeCompare(b))
  const diagnostics: LayoutDiagnostic[] = cyclicComponents.map(component => ({
    code: 'PARENTAGE_CYCLE',
    ids: [...component],
    message: `Parentage cycle detected: ${component.join(', ')}`,
  }))

  const componentOutgoing = components.map(() => new Set<number>())
  const indegree = components.map(() => 0)
  for (const [sourceUnitId, targetUnitIds] of outgoing) {
    const sourceComponent = componentByUnitId.get(sourceUnitId)
    if (sourceComponent === undefined) continue
    for (const targetUnitId of targetUnitIds) {
      const targetComponent = componentByUnitId.get(targetUnitId)
      if (
        targetComponent === undefined
        || targetComponent === sourceComponent
        || componentOutgoing[sourceComponent].has(targetComponent)
      ) continue
      componentOutgoing[sourceComponent].add(targetComponent)
      indegree[targetComponent]++
    }
  }

  const rankByComponent = components.map(() => 0)
  const ready = indegree
    .map((value, index) => ({ value, index }))
    .filter(entry => entry.value === 0)
    .map(entry => entry.index)
    .sort((a, b) => compareComponents(components, a, b))

  while (ready.length > 0) {
    const sourceComponent = ready.shift()
    if (sourceComponent === undefined) break
    const targets = [...componentOutgoing[sourceComponent]]
      .sort((a, b) => compareComponents(components, a, b))
    for (const targetComponent of targets) {
      rankByComponent[targetComponent] = Math.max(
        rankByComponent[targetComponent],
        rankByComponent[sourceComponent] + 1,
      )
      indegree[targetComponent]--
      if (indegree[targetComponent] === 0) {
        ready.push(targetComponent)
        ready.sort((a, b) => compareComponents(components, a, b))
      }
    }
  }

  const minimumRank = rankByComponent.length > 0 ? Math.min(...rankByComponent) : 0
  const generationByUnitId: Record<string, number> = {}
  for (const unitId of unitIds) {
    const componentIndex = componentByUnitId.get(unitId)
    generationByUnitId[unitId] = componentIndex === undefined
      ? 0
      : rankByComponent[componentIndex] - minimumRank
  }

  return { generationByUnitId, cyclicUnitIds, diagnostics }
}

function compareComponents(components: string[][], left: number, right: number): number {
  return components[left][0].localeCompare(components[right][0])
}

function findStronglyConnectedComponents(
  unitIds: string[],
  outgoing: Map<string, Set<string>>,
): string[][] {
  let nextIndex = 0
  const indexByUnitId = new Map<string, number>()
  const lowLinkByUnitId = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (unitId: string) => {
    const index = nextIndex++
    indexByUnitId.set(unitId, index)
    lowLinkByUnitId.set(unitId, index)
    stack.push(unitId)
    onStack.add(unitId)

    const targetUnitIds = [...(outgoing.get(unitId) ?? [])]
      .sort((a, b) => a.localeCompare(b))
    for (const targetUnitId of targetUnitIds) {
      if (!indexByUnitId.has(targetUnitId)) {
        visit(targetUnitId)
        lowLinkByUnitId.set(unitId, Math.min(
          lowLinkByUnitId.get(unitId) ?? index,
          lowLinkByUnitId.get(targetUnitId) ?? index,
        ))
      } else if (onStack.has(targetUnitId)) {
        lowLinkByUnitId.set(unitId, Math.min(
          lowLinkByUnitId.get(unitId) ?? index,
          indexByUnitId.get(targetUnitId) ?? index,
        ))
      }
    }

    if (lowLinkByUnitId.get(unitId) !== indexByUnitId.get(unitId)) return
    const component: string[] = []
    let poppedUnitId: string | undefined
    do {
      poppedUnitId = stack.pop()
      if (poppedUnitId === undefined) break
      onStack.delete(poppedUnitId)
      component.push(poppedUnitId)
    } while (poppedUnitId !== unitId)
    components.push(component)
  }

  for (const unitId of unitIds) {
    if (!indexByUnitId.has(unitId)) visit(unitId)
  }
  return components
}

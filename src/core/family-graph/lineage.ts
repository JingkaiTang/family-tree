import type { FamilyFacts } from './types'

export interface LineageIndex {
  personIds: ReadonlySet<string>
  parentagesByParentId: ReadonlyMap<string, readonly LineageParentage[]>
  parentagesByChildId: ReadonlyMap<string, readonly LineageParentage[]>
}

interface LineageParentage {
  id: string
  parentIds: readonly string[]
  childIds: readonly string[]
}

export interface LineageTrace {
  personIds: string[]
  ancestorIds: string[]
  descendantIds: string[]
  /** Only traversed child branches in each parentage; siblings remain unhighlighted. */
  parentageChildren: Record<string, string[]>
}

/** Build once per facts revision; hovering a person only traverses their lineage. */
export function buildLineageIndex(facts: FamilyFacts): LineageIndex {
  const personIds = new Set(facts.people.map(person => person.id).filter(Boolean))
  const parentagesByParentId = new Map<string, LineageParentage[]>()
  const parentagesByChildId = new Map<string, LineageParentage[]>()

  for (const fact of facts.parentages) {
    const parentage = {
      id: fact.id,
      parentIds: [...new Set(fact.parentIds.filter(id => personIds.has(id)))],
      childIds: [...new Set(fact.childIds.filter(id => personIds.has(id)))],
    }
    if (!parentage.parentIds.length || !parentage.childIds.length) continue
    for (const parentId of parentage.parentIds) {
      const groups = parentagesByParentId.get(parentId) ?? []
      groups.push(parentage)
      parentagesByParentId.set(parentId, groups)
    }
    for (const childId of parentage.childIds) {
      const groups = parentagesByChildId.get(childId) ?? []
      groups.push(parentage)
      parentagesByChildId.set(childId, groups)
    }
  }

  return { personIds, parentagesByParentId, parentagesByChildId }
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right))
}

/**
 * Trace upward and downward independently. Descending again from an ancestor
 * would incorrectly include siblings, cousins, and their descendants.
 */
export function traceLineage(index: LineageIndex, personId: string | null | undefined): LineageTrace {
  if (!personId || !index.personIds.has(personId)) {
    return { personIds: [], ancestorIds: [], descendantIds: [], parentageChildren: {} }
  }

  const selectedId = personId
  const childrenByParentageId = new Map<string, Set<string>>()
  function traverse(direction: 'ancestors' | 'descendants'): Set<string> {
    const seen = new Set([selectedId])
    const queue = [selectedId]
    const groupsByPersonId = direction === 'ancestors'
      ? index.parentagesByChildId
      : index.parentagesByParentId

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentId = queue[cursor]
      for (const group of groupsByPersonId.get(currentId) ?? []) {
        const relatedIds = direction === 'ancestors' ? group.parentIds : group.childIds
        for (const relatedId of relatedIds) {
          if (relatedId === currentId) continue
          const childIds = childrenByParentageId.get(group.id) ?? new Set<string>()
          childIds.add(direction === 'ancestors' ? currentId : relatedId)
          childrenByParentageId.set(group.id, childIds)
          if (seen.has(relatedId)) continue
          seen.add(relatedId)
          queue.push(relatedId)
        }
      }
    }

    seen.delete(selectedId)
    return seen
  }

  const ancestors = traverse('ancestors')
  const descendants = traverse('descendants')
  return {
    personIds: sortedIds(new Set([personId, ...ancestors, ...descendants])),
    ancestorIds: sortedIds(ancestors),
    descendantIds: sortedIds(descendants),
    parentageChildren: Object.fromEntries(
      [...childrenByParentageId].map(([id, childIds]) => [id, sortedIds(childIds)]),
    ),
  }
}

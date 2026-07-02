import { type FamilyData, SCHEMA_VERSION, type Member } from './schema'

type MutableFamily = Record<string, unknown> & {
  schemaVersion: number
  members?: Record<string, Member>
  childLayoutAssignments?: FamilyData['childLayoutAssignments']
  gridLayoutOverrides?: FamilyData['gridLayoutOverrides']
}

type SpouseType = Member['spouses'][number]['type']

interface SpouseEdge {
  key: string
  leftId: string
  rightId: string
  type: SpouseType
}

export function migrate(raw: unknown): FamilyData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid family data: root value is not an object')
  }

  const data = raw as Record<string, unknown>
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0
  let current: MutableFamily = { ...data, schemaVersion: version }

  if (current.schemaVersion < 2) {
    current = migrateV1ToV2(current)
  }

  current.schemaVersion = SCHEMA_VERSION
  current.members = current.members ?? {}
  current.childLayoutAssignments = current.childLayoutAssignments ?? {}
  current.gridLayoutOverrides = current.gridLayoutOverrides ?? {}
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
  const edges = collectSpouseEdges(members)
  const acceptedCurrentEdges = chooseCurrentSpouseEdges(edges)

  for (const memberId of sortedMemberIds(members)) {
    const member = members[memberId]
    member.spouses = edges
      .filter((edge) => edge.leftId === memberId || edge.rightId === memberId)
      .map((edge) => {
        const type: SpouseType = acceptedCurrentEdges.has(edge.key) ? 'married' : 'divorced'
        return {
          id: edge.leftId === memberId ? edge.rightId : edge.leftId,
          type,
        }
      })
      .sort((left, right) => compareIds(left.id, right.id))
  }
}

function collectSpouseEdges(members: Record<string, Member>): SpouseEdge[] {
  const edgeByKey = new Map<string, SpouseEdge>()
  for (const memberId of sortedMemberIds(members)) {
    const member = members[memberId]
    for (const spouse of member.spouses) {
      if (spouse.id === memberId || !members[spouse.id]) continue
      const [leftId, rightId] = [memberId, spouse.id].sort(compareIds)
      const key = spouseEdgeKey(leftId, rightId)
      const existing = edgeByKey.get(key)
      edgeByKey.set(key, {
        key,
        leftId,
        rightId,
        type: existing?.type === 'married' || spouse.type === 'married' ? 'married' : 'divorced',
      })
    }
  }

  return [...edgeByKey.values()].sort(compareSpouseEdges)
}

function chooseCurrentSpouseEdges(edges: SpouseEdge[]): Set<string> {
  const usedMemberIds = new Set<string>()
  const accepted = new Set<string>()

  for (const edge of edges) {
    if (edge.type !== 'married') continue
    if (usedMemberIds.has(edge.leftId) || usedMemberIds.has(edge.rightId)) continue
    accepted.add(edge.key)
    usedMemberIds.add(edge.leftId)
    usedMemberIds.add(edge.rightId)
  }

  return accepted
}

function inferChildLayoutAssignments(
  members: Record<string, Member>,
): FamilyData['childLayoutAssignments'] {
  const assignments: FamilyData['childLayoutAssignments'] = {}
  for (const child of Object.values(members).sort((left, right) => compareIds(left.id, right.id))) {
    const parentIds = uniqueSortedIds(child.parents.map((parent) => parent.id).filter((id) => Boolean(members[id])))
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

function spouseEdgeKey(leftId: string, rightId: string): string {
  return `${leftId}\0${rightId}`
}

function sortedMemberIds(members: Record<string, Member>): string[] {
  return Object.keys(members).sort(compareIds)
}

function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort(compareIds)
}

function compareSpouseEdges(left: SpouseEdge, right: SpouseEdge): number {
  return compareIds(left.leftId, right.leftId) || compareIds(left.rightId, right.rightId)
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b)
}

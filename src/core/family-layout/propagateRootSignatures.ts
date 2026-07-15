import { mergeRootSignatures, rootSignatureKey } from './rootSignatures'
import type {
  FamilyUnit,
  ProjectedFamily,
  RootDiscoveryResult,
  RootSignature,
  RootSignatureResult,
} from './types'

export interface PropagateRootSignaturesInput {
  projected: ProjectedFamily
  units: FamilyUnit[]
  roots: RootDiscoveryResult
}

export function propagateRootSignatures(
  input: PropagateRootSignaturesInput,
): RootSignatureResult {
  const signatureByPersonId = Object.fromEntries(
    input.projected.people
      .map(person => person.id)
      .sort((left, right) => left.localeCompare(right))
      .map(personId => [personId, [] as RootSignature]),
  )
  for (const [personId, rootId] of Object.entries(input.roots.seedRootIdByPersonId)) {
    signatureByPersonId[personId] = [rootId]
  }

  const partnerIdByPersonId = buildCurrentPartnerMap(input.projected)
  const maximumPasses = input.projected.people.length + 1
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false
    for (const parentage of [...input.projected.primaryParentages]
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const inherited = mergeRootSignatures(
        ...parentage.parentIds.map(parentId => signatureByPersonId[parentId] ?? []),
      )
      for (const childId of [...parentage.childIds]
        .sort((left, right) => left.localeCompare(right))) {
        if (parentage.typeByChildId[childId] === 'step') continue
        changed = mergeIntoPerson(signatureByPersonId, childId, inherited) || changed
      }
    }
    changed = inheritSuppressedIncomingSpouses(
      signatureByPersonId,
      input.roots.suppressedIncomingPersonIds,
      partnerIdByPersonId,
    ) || changed
    if (!changed) break
  }

  const signatureByUnitId = Object.fromEntries(
    [...input.units]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(unit => [
        unit.id,
        mergeRootSignatures(
          ...unit.memberIds.map(personId => signatureByPersonId[personId] ?? []),
        ),
      ]),
  )
  const sourceRootIdByPersonId = Object.fromEntries(
    Object.entries(signatureByPersonId)
      .filter(([, signature]) => signature.length === 1)
      .map(([personId, signature]) => [personId, signature[0]]),
  )

  return {
    signatureByPersonId,
    signatureByUnitId,
    sourceRootIdByPersonId,
    diagnostics: [],
  }
}

function mergeIntoPerson(
  signatureByPersonId: Record<string, RootSignature>,
  personId: string,
  inherited: RootSignature,
): boolean {
  const current = signatureByPersonId[personId] ?? []
  const merged = mergeRootSignatures(current, inherited)
  if (rootSignatureKey(merged) === rootSignatureKey(current)) return false
  signatureByPersonId[personId] = merged
  return true
}

function inheritSuppressedIncomingSpouses(
  signatureByPersonId: Record<string, RootSignature>,
  suppressedIncomingPersonIds: string[],
  partnerIdByPersonId: ReadonlyMap<string, string>,
): boolean {
  let changed = false
  for (const personId of [...suppressedIncomingPersonIds]
    .sort((left, right) => left.localeCompare(right))) {
    if ((signatureByPersonId[personId]?.length ?? 0) > 0) continue
    const partnerId = partnerIdByPersonId.get(personId)
    if (partnerId === undefined) continue
    const partnerSignature = signatureByPersonId[partnerId] ?? []
    if (partnerSignature.length === 0) continue
    signatureByPersonId[personId] = [...partnerSignature]
    changed = true
  }
  return changed
}

function buildCurrentPartnerMap(projected: ProjectedFamily): Map<string, string> {
  const partnerIdByPersonId = new Map<string, string>()
  for (const partnership of [...projected.primaryPartnerships]
    .filter(value => value.status === 'current')
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const [leftId, rightId] = partnership.partnerIds
    if (leftId === undefined || rightId === undefined) continue
    partnerIdByPersonId.set(leftId, rightId)
    partnerIdByPersonId.set(rightId, leftId)
  }
  return partnerIdByPersonId
}

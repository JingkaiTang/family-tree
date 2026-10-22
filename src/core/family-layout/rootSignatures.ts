import type { RootSignature } from './types'
import { compareIds, encodeIdTuple } from '@/core/idEncoding'

export function normalizeRootSignature(rootIds: Iterable<string>): RootSignature {
  return [...new Set(rootIds)].sort(compareIds)
}

export function mergeRootSignatures(
  ...signatures: RootSignature[]
): RootSignature {
  return normalizeRootSignature(signatures.flat())
}

export function rootSignatureKey(signature: RootSignature): string {
  return encodeIdTuple(normalizeRootSignature(signature), '|')
}

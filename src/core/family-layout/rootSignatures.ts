import type { RootSignature } from './types'

export function normalizeRootSignature(rootIds: Iterable<string>): RootSignature {
  return [...new Set(rootIds)].sort((left, right) => left.localeCompare(right))
}

export function mergeRootSignatures(
  ...signatures: RootSignature[]
): RootSignature {
  return normalizeRootSignature(signatures.flat())
}

export function rootSignatureKey(signature: RootSignature): string {
  return normalizeRootSignature(signature).join('|')
}

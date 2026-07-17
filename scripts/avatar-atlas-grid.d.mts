export function parseEdgeProfile(output: string, expectedSize: number): number[]

export function detectSegmentBoundaries(
  profile: number[],
  segments: number,
): { boundaries: number[]; scores: number[] }

export function parseEdgeProfile(output, expectedSize) {
  const profile = Array(expectedSize).fill(Number.NaN)
  for (const line of output.split('\n')) {
    const match = line.match(/^0,(\d+): \((\d+)/)
    if (!match) continue
    profile[Number(match[1])] = Number(match[2])
  }
  if (profile.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot parse the complete horizontal edge profile')
  }
  return profile
}

export function detectSegmentBoundaries(profile, segments) {
  if (!Number.isInteger(segments) || segments < 2 || profile.length < segments) {
    throw new Error('Invalid grid dimensions')
  }

  const expectedSize = profile.length / segments
  const boundaries = [0]
  const scores = []

  for (let index = 1; index < segments; index += 1) {
    const start = Math.max(
      boundaries.at(-1) + 1,
      Math.floor((index - 0.45) * expectedSize),
    )
    const end = Math.min(
      profile.length - 1,
      Math.ceil((index + 0.45) * expectedSize),
    )
    const candidates = profile.slice(start, end + 1)
    const bestScore = Math.max(...candidates)
    const best = start + candidates.indexOf(bestScore)
    const sorted = [...candidates].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    if (bestScore < 16 || bestScore < median * 3) {
      throw new Error(`Cannot find a clear grid seam near row ${index + 1}`)
    }

    boundaries.push(best)
    scores.push(bestScore)
  }

  boundaries.push(profile.length)
  return { boundaries, scores }
}

import { describe, expect, it } from 'vitest'

import {
  detectSegmentBoundaries,
  parseEdgeProfile,
} from '../../../scripts/avatar-atlas-grid.mjs'

describe('avatar atlas grid detection', () => {
  it('detects uneven row seams instead of assuming equal-height rows', () => {
    const profile = Array(1086).fill(3)
    for (const [row, score] of [[197, 208], [393, 196], [589, 115], [779, 100], [949, 93]]) {
      profile[row] = score
    }

    expect(detectSegmentBoundaries(profile, 6).boundaries)
      .toEqual([0, 197, 393, 589, 779, 949, 1086])
  })

  it('rejects an atlas without clear horizontal seams', () => {
    expect(() => detectSegmentBoundaries(Array(1086).fill(3), 6))
      .toThrow('Cannot find a clear grid seam')
  })

  it('parses ImageMagick grayscale profile rows', () => {
    const output = [
      '# ImageMagick pixel enumeration: 1,2,0,255,gray',
      '0,0: (3)  #030303  gray(3)',
      '0,1: (208)  #D0D0D0  gray(208)',
    ].join('\n')

    expect(parseEdgeProfile(output, 2)).toEqual([3, 208])
  })
})

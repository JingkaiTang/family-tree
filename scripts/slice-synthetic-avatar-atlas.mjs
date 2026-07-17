import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SYNTHETIC_AVATARS_PER_GENERATION,
  SYNTHETIC_GENERATION_COUNTS,
} from './synthetic-family.mjs'
import {
  detectSegmentBoundaries,
  parseEdgeProfile,
} from './avatar-atlas-grid.mjs'

const atlasArg = process.argv[2]
if (!atlasArg) {
  console.error('Usage: npm run slice:test-avatars -- /absolute/path/to/avatar-atlas.png')
  process.exit(1)
}

const atlasPath = resolve(atlasArg)
const projectUrl = new URL('../test-data/synthetic-family-200-6.family/', import.meta.url)
const photosPath = fileURLToPath(new URL('media/photos/', projectUrl))
const thumbsPath = fileURLToPath(new URL('media/thumbs/', projectUrl))
await Promise.all([
  mkdir(photosPath, { recursive: true }),
  mkdir(thumbsPath, { recursive: true }),
])

const identify = runMagick(['identify', '-format', '%w %h', atlasPath])
const [width, height] = identify.trim().split(/\s+/).map(Number)
if (!Number.isFinite(width) || !Number.isFinite(height)) {
  throw new Error(`Cannot determine atlas dimensions: ${identify}`)
}

const columns = SYNTHETIC_AVATARS_PER_GENERATION
const rows = SYNTHETIC_GENERATION_COUNTS.length
const seamInset = 2
const edgeOutput = runMagick([
  atlasPath,
  '-colorspace', 'gray',
  '-edge', '1',
  '-filter', 'box',
  '-resize', `1x${height}!`,
  '-depth', '8',
  'txt:-',
])
const edgeProfile = parseEdgeProfile(edgeOutput, height)
const { boundaries: rowBoundaries } = detectSegmentBoundaries(edgeProfile, rows)

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const left = Math.round(column * width / columns)
    const right = Math.round((column + 1) * width / columns)
    const top = rowBoundaries[row] + (row === 0 ? 0 : seamInset)
    const bottom = rowBoundaries[row + 1] - (row === rows - 1 ? 0 : seamInset)
    const cellWidth = right - left
    const cellHeight = bottom - top
    const cropSize = Math.min(cellWidth, cellHeight)
    const cropX = left + Math.floor((cellWidth - cropSize) / 2)
    const cropY = top + Math.floor((cellHeight - cropSize) / 2)
    const photoId = `synthetic-avatar-g${row + 1}-${String(column + 1).padStart(2, '0')}`
    const crop = `${cropSize}x${cropSize}+${cropX}+${cropY}`
    const photoPath = resolve(photosPath, `${photoId}.webp`)
    const thumbPath = resolve(thumbsPath, `${photoId}.webp`)

    runMagick([
      atlasPath,
      '-crop', crop,
      '+repage',
      '-resize', '512x512!',
      '-quality', '82',
      photoPath,
    ])
    runMagick([
      photoPath,
      '-resize', '256x256!',
      '-quality', '72',
      thumbPath,
    ])
  }
}

console.log(`Detected atlas row boundaries: ${rowBoundaries.join(', ')}`)
console.log(`Sliced ${columns * rows} avatars from ${basename(atlasPath)}`)

function runMagick(args) {
  const result = spawnSync('magick', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || `magick ${args.join(' ')} failed`)
  }
  return result.stdout
}

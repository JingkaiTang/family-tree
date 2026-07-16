import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  SYNTHETIC_FAMILY_SEED,
  syntheticAvatarManifest,
  syntheticFamily200,
  syntheticFamilyStats,
} from './synthetic-family.mjs'

const projectUrl = new URL('../test-data/synthetic-family-200-6.family/', import.meta.url)
const projectPath = fileURLToPath(projectUrl)
const family = syntheticFamily200()
const createdAt = '2026-07-16T00:00:00.000Z'

await Promise.all([
  mkdir(new URL('media/photos/', projectUrl), { recursive: true }),
  mkdir(new URL('media/thumbs/', projectUrl), { recursive: true }),
  mkdir(new URL('.trash/', projectUrl), { recursive: true }),
])

await Promise.all([
  writeJson(new URL('family.json', projectUrl), family),
  writeJson(new URL('meta.json', projectUrl), {
    name: '虚构六代家族（200人）',
    schemaVersion: family.schemaVersion,
    createdAt,
    updatedAt: createdAt,
  }),
  writeJson(new URL('avatar-manifest.json', projectUrl), syntheticAvatarManifest(family)),
  writeJson(new URL('dataset-stats.json', projectUrl), {
    seed: SYNTHETIC_FAMILY_SEED,
    ...syntheticFamilyStats(family),
  }),
])

console.log(`Generated synthetic family project at ${projectPath}`)

async function writeJson(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

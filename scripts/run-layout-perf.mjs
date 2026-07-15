import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const vitestPath = fileURLToPath(new URL(
  './vitest.mjs',
  import.meta.resolve('vitest/package.json'),
))
const result = spawnSync(process.execPath, [
  vitestPath,
  'run',
  'src/core/family-layout/layoutPerformance.test.ts',
  '--disableConsoleIntercept',
  ...process.argv.slice(2),
], {
  env: { ...process.env, FAMILY_LAYOUT_PERF_BUDGET_MS: '1000' },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1

import type { Member } from './schema'
import type { LayoutScene } from './family-layout/types'
import {
  layoutFamilyTreeSync,
  type LayoutFamilyTreeOptions,
} from './treeLayoutCore'
import { LayoutWorkerClient } from './treeLayoutWorkerClient'

export type { LayoutScene } from './family-layout/types'
export type { LayoutFamilyTreeOptions } from './treeLayoutCore'

let workerClient: LayoutWorkerClient | null = null
let workerDisabled = false

export async function layoutFamilyTree(
  members: Member[],
  options: LayoutFamilyTreeOptions = {},
): Promise<LayoutScene> {
  if (!canUseWorker()) return layoutFamilyTreeSync(members, options)

  try {
    workerClient ??= new LayoutWorkerClient(new Worker(
      new URL('./treeLayout.worker.ts', import.meta.url),
      { type: 'module', name: 'family-tree-layout' },
    ))
    return await workerClient.layout(members, options)
  } catch {
    // Worker 初始化或运行失败时保留完整功能，下一次调用直接走同步回退。
    workerClient?.dispose()
    workerClient = null
    workerDisabled = true
    return layoutFamilyTreeSync(members, options)
  }
}

function canUseWorker(): boolean {
  return !workerDisabled && (workerClient !== null
    ? true
    : typeof window !== 'undefined' && typeof Worker !== 'undefined')
}

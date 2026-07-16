import type { Member } from './schema'
import type { LayoutScene } from './family-layout/types'
import type { LayoutFamilyTreeOptions } from './treeLayoutCore'
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './treeLayoutProtocol'

export interface LayoutWorkerPort {
  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: LayoutWorkerRequest): void
  terminate(): void
}

interface PendingLayout {
  resolve: (scene: LayoutScene) => void
  reject: (error: Error) => void
}

export class LayoutWorkerClient {
  private readonly pending = new Map<number, PendingLayout>()
  private nextRequestId = 0
  private failed = false

  constructor(private readonly worker: LayoutWorkerPort) {
    worker.onmessage = event => this.handleMessage(event.data)
    worker.onerror = event => this.failAll(event.message || '布局 Worker 运行失败')
  }

  layout(members: Member[], options: LayoutFamilyTreeOptions): Promise<LayoutScene> {
    if (this.failed) return Promise.reject(new Error('布局 Worker 已停用'))
    const id = ++this.nextRequestId
    return new Promise<LayoutScene>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker.postMessage({ id, members, options })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose() {
    this.failAll('布局 Worker 已关闭')
  }

  private handleMessage(response: LayoutWorkerResponse) {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.scene)
    else pending.reject(new Error(response.error))
  }

  private failAll(message: string) {
    if (this.failed) return
    this.failed = true
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error(message))
    this.pending.clear()
  }
}

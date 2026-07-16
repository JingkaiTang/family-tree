import { describe, expect, it } from 'vitest'
import type { LayoutScene } from './family-layout/types'
import { LayoutWorkerClient, type LayoutWorkerPort } from './treeLayoutWorkerClient'
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './treeLayoutProtocol'

const emptyScene: LayoutScene = {
  units: [],
  cards: [],
  hubs: [],
  rows: [],
  rootDomains: [],
  bridgeDomains: [],
  gateways: [],
  routes: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  diagnostics: [],
}

class FakeWorker implements LayoutWorkerPort {
  onmessage: ((event: MessageEvent<LayoutWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  requests: LayoutWorkerRequest[] = []
  terminated = false

  postMessage(message: LayoutWorkerRequest) {
    this.requests.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(response: LayoutWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<LayoutWorkerResponse>)
  }

  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

describe('LayoutWorkerClient', () => {
  it('按请求 ID 匹配乱序返回的布局结果', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(worker)
    const first = client.layout([], {})
    const second = client.layout([], {})
    const firstId = worker.requests[0].id
    const secondId = worker.requests[1].id
    const secondScene = { ...emptyScene, bounds: { x: 2, y: 0, width: 0, height: 0 } }

    worker.respond({ id: secondId, ok: true, scene: secondScene })
    worker.respond({ id: firstId, ok: true, scene: emptyScene })

    await expect(first).resolves.toEqual(emptyScene)
    await expect(second).resolves.toEqual(secondScene)
  })

  it('只拒绝 Worker 返回错误的对应请求', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(worker)
    const pending = client.layout([], {})

    worker.respond({ id: worker.requests[0].id, ok: false, error: 'bad layout' })

    await expect(pending).rejects.toThrow('bad layout')
  })

  it('Worker 崩溃时拒绝全部请求并终止实例', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(worker)
    const first = client.layout([], {})
    const second = client.layout([], {})

    worker.fail('worker crashed')

    await expect(first).rejects.toThrow('worker crashed')
    await expect(second).rejects.toThrow('worker crashed')
    expect(worker.terminated).toBe(true)
    await expect(client.layout([], {})).rejects.toThrow('已停用')
  })
})

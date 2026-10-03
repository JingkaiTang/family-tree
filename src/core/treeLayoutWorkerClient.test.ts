import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { threeGenFamily } from '@/__tests__/fixtures/families'
import { createEmptyFamily } from './schema'
import type { LayoutScene } from './family-layout/types'
import { layoutFamilyTreeSync } from './treeLayoutCore'
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
    // Match the real Worker boundary: Vue proxies cannot be structured-cloned.
    this.requests.push(structuredClone(message))
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
  it('将响应式项目及嵌套布局状态发送为独立快照，后续编辑不改变已发送的数据', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(worker)
    const data = reactive({ ...createEmptyFamily(), members: threeGenFamily() })
    data.members.self.firstName = '发送时的名字'
    const previousScene = reactive(layoutFamilyTreeSync(Object.values(data.members), { data }))
    const options = {
      data,
      previousScene,
      view: reactive({ primaryPartnershipByPerson: { dad: 'selected-partnership' } }),
      changedIds: reactive(['self']),
    }
    const expected = JSON.parse(JSON.stringify({ members: Object.values(data.members), options }))
    const pending = client.layout(Object.values(data.members), options)

    data.members.self.firstName = '发送后的新编辑'
    previousScene.cards[0].rect.x += 100
    options.view.primaryPartnershipByPerson.dad = 'changed-partnership'
    options.changedIds.push('dad')
    worker.respond({ id: worker.requests[0]?.id ?? 1, ok: true, scene: emptyScene })

    await expect(pending).resolves.toEqual(emptyScene)
    expect(worker.requests[0]).toEqual({ id: 1, ...expected })
    expect(worker.terminated).toBe(false)

    const next = client.layout(Object.values(data.members), options)
    worker.respond({ id: worker.requests[1].id, ok: true, scene: emptyScene })
    await expect(next).resolves.toEqual(emptyScene)
    expect(worker.requests[1].options.data?.members.self.firstName).toBe('发送后的新编辑')
  })

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

  it('快照编码失败只拒绝该请求，保留并发请求且允许后续调用', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(worker)
    const pending = client.layout([], {})
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const invalidData = { ...createEmptyFamily(), extension: circular }

    await expect(client.layout([], { data: invalidData })).rejects.toBeInstanceOf(TypeError)
    expect(worker.requests).toHaveLength(1)
    expect(worker.terminated).toBe(false)
    worker.respond({ id: worker.requests[0].id, ok: true, scene: emptyScene })
    await expect(pending).resolves.toEqual(emptyScene)

    const next = client.layout([], {})
    expect(worker.requests[1].id).toBe(3)
    worker.respond({ id: worker.requests[1].id, ok: true, scene: emptyScene })
    await expect(next).resolves.toEqual(emptyScene)
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

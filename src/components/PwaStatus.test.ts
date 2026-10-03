// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PwaStatus from './PwaStatus.vue'

describe('PWA shell lifecycle', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('BASE_URL', './')
  })

  afterEach(() => {
    document.head.querySelector('base')?.remove()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function serviceWorkerFixture(waiting = false) {
    const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() })
    const registration = Object.assign(new EventTarget(), {
      waiting: waiting ? worker : null,
      installing: worker,
    })
    const serviceWorker = {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    }
    vi.stubGlobal('navigator', { serviceWorker })
    return { worker, registration, serviceWorker }
  }

  it('registers within the deployed subdirectory', async () => {
    const base = document.createElement('base')
    base.href = 'https://example.test/family/'
    document.head.append(base)
    const { serviceWorker } = serviceWorkerFixture()
    const wrapper = mount(PwaStatus)
    await flushPromises()
    const [url, options] = serviceWorker.register.mock.calls[0]!
    expect(String(url)).toBe('https://example.test/family/sw.js')
    expect(options).toEqual({ scope: '/family/' })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not register a service worker during development', async () => {
    vi.stubEnv('PROD', false)
    const { serviceWorker } = serviceWorkerFixture()
    const wrapper = mount(PwaStatus)
    await flushPromises()
    expect(serviceWorker.register).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('leaves a downloaded update waiting without activating it or refreshing editors', async () => {
    const { worker } = serviceWorkerFixture(true)
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const wrapper = mount(PwaStatus)
    await flushPromises()
    expect(wrapper.text()).toContain('保存并关闭所有家族树窗口')
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('notices an update installed after the app opened and removes its listeners', async () => {
    const { registration, worker } = serviceWorkerFixture()
    const wrapper = mount(PwaStatus)
    await flushPromises()
    registration.waiting = worker
    worker.dispatchEvent(new Event('statechange'))
    await flushPromises()
    expect(wrapper.text()).toContain('新版已准备好')
    const removeListener = vi.spyOn(worker, 'removeEventListener')
    wrapper.unmount()
    expect(removeListener).toHaveBeenCalledWith('statechange', expect.any(Function))
  })

  it('reports registration failure without blocking the app', async () => {
    const { serviceWorker } = serviceWorkerFixture()
    serviceWorker.register.mockRejectedValue(new Error('network unavailable'))
    const wrapper = mount(PwaStatus)
    await flushPromises()
    expect(wrapper.text()).toContain('联网时仍可使用')
    wrapper.unmount()
  })

  it('reports failed initial precaching even when registration succeeded', async () => {
    const { serviceWorker, worker } = serviceWorkerFixture()
    Object.assign(serviceWorker, { controller: null })
    const wrapper = mount(PwaStatus)
    await flushPromises()
    Object.assign(worker, { state: 'redundant' })
    worker.dispatchEvent(new Event('statechange'))
    await flushPromises()
    expect(wrapper.text()).toContain('离线资源准备失败')
    wrapper.unmount()
  })

  it('keeps the previous offline version available when an update fails', async () => {
    const { worker, registration } = serviceWorkerFixture()
    Object.assign(registration, { active: {} })
    const wrapper = mount(PwaStatus)
    await flushPromises()
    Object.assign(worker, { state: 'redundant' })
    worker.dispatchEvent(new Event('statechange'))
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

/**
 * @vitest-environment happy-dom
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PanZoomWrapper from '@/components/tree/PanZoomWrapper.vue'

const { panzoom } = vi.hoisted(() => ({
  panzoom: vi.fn(() => ({
    destroy: vi.fn(),
    getOptions: vi.fn(() => ({ minScale: 0.2, maxScale: 3, step: 0.3 })),
    getPan: vi.fn(() => ({ x: 0, y: 0 })),
    getScale: vi.fn(() => 0.5),
    pan: vi.fn(),
    reset: vi.fn(),
    zoom: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomWithWheel: vi.fn(),
  })),
}))

vi.mock('@panzoom/panzoom', () => ({ default: panzoom }))

describe('PanZoomWrapper', () => {
  it('keeps the stage anchored to its top-left corner when restoring a zoomed view', () => {
    const wrapper = mount(PanZoomWrapper, {
      attachTo: document.body,
      props: {
        initialView: { x: 0, y: 0, scale: 0.5 },
      },
      slots: {
        default: '<div style="width: 4000px; height: 1000px" />',
      },
    })

    expect(panzoom).toHaveBeenCalledWith(
      wrapper.get('.pz-stage').element,
      expect.objectContaining({ origin: '0 0' }),
    )

    wrapper.unmount()
  })

  it('keeps the viewport center fixed when toolbar buttons change scale', async () => {
    const wrapper = mount(PanZoomWrapper, { attachTo: document.body })
    const host = wrapper.get('.pz-stage').element.parentElement!
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 800,
    } as DOMRect)
    const instance = panzoom.mock.results.at(-1)!.value
    const targetScale = 0.5 * Math.exp(-0.3)

    await wrapper.findAll('button')[1].trigger('click')

    expect(instance.zoom).toHaveBeenCalledWith(targetScale, {
      animate: true,
      focal: {
        x: 500 * targetScale,
        y: 400 * targetScale,
      },
    })
    expect(instance.zoomOut).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the pointer position fixed during modified-wheel zoom', async () => {
    const wrapper = mount(PanZoomWrapper, { attachTo: document.body })
    const host = wrapper.get('.pz-stage').element.parentElement!
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 800,
    } as DOMRect)
    const instance = panzoom.mock.results.at(-1)!.value
    const targetScale = 0.5 * Math.exp(0.3 / 3)

    await wrapper.trigger('wheel', {
      ctrlKey: true,
      clientX: 350,
      clientY: 450,
      deltaY: -120,
    })

    expect(instance.zoom).toHaveBeenCalledWith(targetScale, {
      animate: false,
      focal: {
        x: 250 * targetScale,
        y: 250 * targetScale,
      },
    })
    expect(instance.zoomWithWheel).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

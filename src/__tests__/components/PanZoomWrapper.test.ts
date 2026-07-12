/**
 * @vitest-environment happy-dom
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PanZoomWrapper from '@/components/tree/PanZoomWrapper.vue'

const { panzoom } = vi.hoisted(() => ({
  panzoom: vi.fn(() => ({
    destroy: vi.fn(),
    getPan: vi.fn(() => ({ x: 0, y: 0 })),
    getScale: vi.fn(() => 0.5),
    pan: vi.fn(),
    reset: vi.fn(),
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
})

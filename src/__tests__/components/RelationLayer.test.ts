/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RelationLayer from '@/components/tree/RelationLayer.vue'
import type { RoutedFamilyEdge, RouteSegment } from '@/core/family-layout/types'

const trunk: RouteSegment = {
  orientation: 'vertical', points: [{ x: 100, y: 0 }, { x: 100, y: 80 }],
}
const leftChild: RouteSegment = {
  orientation: 'horizontal', points: [{ x: 100, y: 80 }, { x: 40, y: 80 }],
}
const rightChild: RouteSegment = {
  orientation: 'horizontal', points: [{ x: 100, y: 80 }, { x: 160, y: 80 }],
}

function branchingRoute(): RoutedFamilyEdge {
  return {
    id: 'route:family',
    routeOwnerId: 'parentage:family',
    kind: 'primary',
    accent: '#4F7CAC',
    segments: [trunk, leftChild, rightChild],
    childPaths: [
      { childPersonId: 'selected', segments: [trunk, leftChild] },
      { childPersonId: 'sibling', segments: [trunk, rightChild] },
    ],
  }
}

describe('RelationLayer lineage paths', () => {
  it('overlays the complete selected child path without highlighting its sibling branch', () => {
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [branchingRoute()], width: 240, height: 160,
        highlightedPaths: [{ routeId: 'route:family', childPersonIds: ['selected'] }],
      },
    })

    const overlays = wrapper.findAll('[data-testid="lineage-route"]')
    expect(overlays.map(path => path.attributes('d'))).toEqual([
      'M 100 0 L 100 80', 'M 100 80 L 40 80',
    ])
    expect(overlays.every(path => path.attributes('data-child-person-id') === 'selected')).toBe(true)
    expect(overlays.every(path => path.attributes('stroke-width') === '3')).toBe(true)
    const basePaths = wrapper.findAll('[data-route-owner] path')
    expect(basePaths).toHaveLength(3)
    expect(basePaths.every(path => path.attributes('style')?.includes('opacity: 0.18'))).toBe(true)
    expect(wrapper.get('svg').element.lastElementChild?.contains(overlays[0].element)).toBe(true)
  })

  it('keeps a dragged route faded even while its direct branch is highlighted', async () => {
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [branchingRoute()], width: 240, height: 160,
        highlightedPaths: [{ routeId: 'route:family', childPersonIds: ['selected'] }],
        fadedRouteIds: ['route:family'],
      },
    })

    expect(wrapper.findAll('[data-route-id="route:family"]')
      .every(path => path.attributes('style')?.includes('opacity: 0.25'))).toBe(true)
    expect(wrapper.find('[data-testid="lineage-route"]').exists()).toBe(false)
    await wrapper.setProps({ fadedRouteIds: [] })
    expect(wrapper.get('[data-testid="lineage-route"]').attributes('style') ?? '')
      .not.toContain('opacity: 0.25')
  })

  it('renders a shared trunk only once while dragging a family with multiple highlighted children', async () => {
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [branchingRoute()], width: 240, height: 160,
        highlightedPaths: [{ routeId: 'route:family', childPersonIds: ['selected', 'sibling'] }],
      },
    })
    expect(wrapper.findAll('[data-testid="lineage-route"]')).toHaveLength(4)

    await wrapper.setProps({ fadedRouteIds: ['route:family'] })

    expect(wrapper.find('[data-testid="lineage-route"]').exists()).toBe(false)
    const trunks = wrapper.findAll('path[d="M 100 0 L 100 80"]')
    expect(trunks).toHaveLength(1)
    expect(trunks[0].attributes('style')).toContain('opacity: 0.25')
    expect(wrapper.findAll('[data-route-id="route:family"]')).toHaveLength(3)

    await wrapper.setProps({ fadedRouteIds: [] })
    expect(wrapper.findAll('[data-testid="lineage-route"]')).toHaveLength(4)
  })

  it('separates bridge crossings from true junctions in normal and highlighted paths', () => {
    const bridge: RouteSegment = {
      orientation: 'bridge',
      points: [{ x: 100, y: 80 }, { x: 110, y: 70 }, { x: 120, y: 80 }],
    }
    const route = branchingRoute()
    route.segments = [...route.segments, bridge]
    route.childPaths![0].segments.push(bridge)
    route.junctions = [{ x: 100, y: 80 }]
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [route], width: 240, height: 160,
        highlightedPaths: [{ routeId: route.id, childPersonIds: ['selected'] }],
      },
    })

    expect(wrapper.get('[data-testid="line-bridge-underlay"]').attributes('stroke')).toBe('#f1f5f9')
    expect(wrapper.get('[data-testid="lineage-bridge-underlay"]').attributes('stroke')).toBe('#f1f5f9')
    expect(wrapper.get('[data-testid="lineage-bridge-underlay"]').attributes('stroke-width')).toBe('8')
    const junctions = wrapper.findAll('[data-testid="line-junction"]')
    expect(junctions).toHaveLength(1)
    expect(junctions[0].attributes('cx')).toBe('100')
    expect(junctions[0].attributes('cy')).toBe('80')
    expect(wrapper.find('circle[cx="110"]').exists()).toBe(false)
  })

  it('compensates stroke widths at half zoom with bounded compensation at extreme zoom', async () => {
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [branchingRoute()], width: 240, height: 160, scale: 0.5,
        highlightedPaths: [{ routeId: 'route:family', childPersonIds: ['selected'] }],
      },
    })

    expect(wrapper.get('[data-route-owner] path').attributes('stroke-width')).toBe('4')
    expect(wrapper.get('[data-testid="lineage-route"]').attributes('stroke-width')).toBe('6')
    await wrapper.setProps({ scale: 0.1 })
    expect(wrapper.get('[data-route-owner] path').attributes('stroke-width')).toBe('5')
    expect(wrapper.get('[data-testid="lineage-route"]').attributes('stroke-width')).toBe('7.5')
    await wrapper.setProps({ scale: 1 })
    expect(wrapper.get('[data-route-owner] path').attributes('stroke-width')).toBe('2')
    expect(wrapper.get('[data-testid="lineage-route"]').attributes('stroke-width')).toBe('3')
  })

  it('never promotes a whole owner route when branch metadata is missing, and dims an empty selection', async () => {
    const route = branchingRoute()
    delete route.childPaths
    const wrapper = mount(RelationLayer, {
      props: {
        routes: [route], width: 240, height: 160,
        highlightedPaths: [{ routeId: route.id, childPersonIds: ['selected'] }],
      },
    })

    expect(wrapper.find('[data-testid="lineage-route"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-route-owner] path')
      .every(path => path.attributes('style')?.includes('opacity: 0.18'))).toBe(true)
    await wrapper.setProps({ routes: [branchingRoute()], highlightedPaths: [] })
    expect(wrapper.find('[data-testid="lineage-route"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-route-owner] path')
      .every(path => path.attributes('style')?.includes('opacity: 0.18'))).toBe(true)
    await wrapper.setProps({ highlightedPaths: undefined })
    expect(wrapper.get('[data-route-owner] path').attributes('style') ?? '').not.toContain('opacity')
  })
})

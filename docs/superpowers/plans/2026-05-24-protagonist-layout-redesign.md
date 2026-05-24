# 主角视角布局重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新设计主角视角布局算法，解决布局混乱、层次不清、节点重叠问题

**Architecture:** 采用混合方案：BFS 计算关系距离 → 按距离分层 → 每层用 ELK 排列 → 计算环形坐标 → 生成连线

**Tech Stack:** TypeScript, ELK.js, Vue 3, Pinia

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/core/protagonistLayout.ts` | 主角视角布局算法（重写） |
| `src/core/protagonistLayout.test.ts` | 测试用例（更新） |
| `src/components/tree/FamilyCanvas.vue` | 布局模式切换（已实现） |
| `src/pages/TreeView.vue` | UI 按钮（已实现） |
| `src/stores/ui.ts` | 状态管理（已实现） |

---

## Task 1: 重写关系距离计算

**Files:**
- Modify: `src/core/protagonistLayout.ts:12-47`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { describe, it, expect } from 'vitest'
import { calcRelationshipDistances } from './protagonistLayout'
import type { Member } from './schema'

describe('calcRelationshipDistances', () => {
  it('主角距离自己为 0', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('1')?.distance).toBe(0)
  })

  it('配偶距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2' }], godparents: [], godchildren: [] },
      { id: '2', firstName: '配偶', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1' }], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('父母距离为 1', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(1)
  })

  it('兄弟姐妹距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [], siblings: [{ id: '2' }], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '兄弟', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [], siblings: [{ id: '1' }], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1' }, { id: '2' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('2')?.distance).toBe(2)
  })

  it('祖父母距离为 2', () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [{ id: '2' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: '父', lastName: '', gender: 'male', parents: [{ id: '3' }], children: [{ id: '1' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '3', firstName: '爷爷', lastName: '', gender: 'male', parents: [], children: [{ id: '2' }], siblings: [], spouses: [], godparents: [], godchildren: [] }
    ]
    const distances = calcRelationshipDistances('1', members)
    expect(distances.get('3')?.distance).toBe(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL with "calcRelationshipDistances is not exported"

- [ ] **Step 3: 实现关系距离计算**

```typescript
// protagonistLayout.ts
export function calcRelationshipDistances(
  protagonistId: string,
  members: Member[],
): Map<string, { distance: number }> {
  const byId = new Map(members.map(m => [m.id, m]))
  const distances = new Map<string, { distance: number }>()

  const queue: Array<{ id: string; dist: number }> = [
    { id: protagonistId, dist: 0 },
  ]
  distances.set(protagonistId, { distance: 0 })

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!
    const m = byId.get(id)
    if (!m) continue

    const neighbors = [
      ...m.parents.map(r => r.id),
      ...m.children.map(r => r.id),
      ...m.spouses.map(r => r.id),
      ...m.siblings.map(r => r.id),
      ...m.godparents.map(r => r.id),
      ...m.godchildren.map(r => r.id),
    ]

    for (const nextId of neighbors) {
      if (!byId.has(nextId)) continue
      if (distances.has(nextId)) continue
      distances.set(nextId, { distance: dist + 1 })
      queue.push({ id: nextId, dist: dist + 1 })
    }
  }

  return distances
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 重写关系距离计算 BFS"
```

---

## Task 2: 实现按距离分层

**Files:**
- Modify: `src/core/protagonistLayout.ts`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { groupByDistance } from './protagonistLayout'

describe('groupByDistance', () => {
  it('按距离分层', () => {
    const distances = new Map([
      ['1', { distance: 0 }],
      ['2', { distance: 1 }],
      ['3', { distance: 1 }],
      ['4', { distance: 2 }],
    ])
    const groups = groupByDistance(distances)
    expect(groups.get(0)).toEqual(['1'])
    expect(groups.get(1)).toEqual(expect.arrayContaining(['2', '3']))
    expect(groups.get(2)).toEqual(['4'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL with "groupByDistance is not exported"

- [ ] **Step 3: 实现按距离分层**

```typescript
// protagonistLayout.ts
export function groupByDistance(
  distances: Map<string, { distance: number }>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const [id, { distance }] of distances) {
    if (!groups.has(distance)) groups.set(distance, [])
    groups.get(distance)!.push(id)
  }
  return groups
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 实现按距离分层"
```

---

## Task 3: 实现每层用 ELK 排列

**Files:**
- Modify: `src/core/protagonistLayout.ts`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { layoutLayerWithElk } from './protagonistLayout'

describe('layoutLayerWithElk', () => {
  it('返回节点坐标，无重叠', async () => {
    const members: Member[] = [
      { id: '1', firstName: 'A', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
      { id: '2', firstName: 'B', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutLayerWithElk(members, new Map([['1', { distance: 1 }], ['2', { distance: 1 }]]))
    expect(result.nodes.length).toBe(2)
    // 检查无重叠
    const [n1, n2] = result.nodes
    expect(Math.abs(n1.cx - n2.cx)).toBeGreaterThan(2) // NODE_W = 2
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL with "layoutLayerWithElk is not exported"

- [ ] **Step 3: 实现每层 ELK 排列**

```typescript
// protagonistLayout.ts
import type { LayoutResult, LaidOutNode } from './elkLayout'

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5

interface ElkNode {
  id: string
  width: number
  height: number
  x?: number
  y?: number
}

interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
}

interface ElkGraph {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}

export async function layoutLayerWithElk(
  layerMembers: Member[],
  distances: Map<string, { distance: number }>,
): Promise<{ nodes: LaidOutNode[] }> {
  if (layerMembers.length === 0) return { nodes: [] }

  const byId = new Map(layerMembers.map(m => [m.id, m]))

  // 构建 couples
  const couples = buildCouplesForLayer(layerMembers, byId)

  // 构建 ELK 图
  const elkNodes: ElkNode[] = couples.map(c => ({
    id: c.id,
    width: c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W,
    height: NODE_H,
  }))

  const elkGraph: ElkGraph = {
    id: 'layer',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': String(UNIT_GAP),
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: elkNodes,
    edges: [],
  }

  // 调用 ELK
  const elk = await getElk()
  const layouted = await elk.layout(elkGraph)

  // 转换结果
  const nodes: LaidOutNode[] = []
  const coupleById = new Map(couples.map(c => [c.id, c]))

  for (const elkNode of layouted.children) {
    const couple = coupleById.get(elkNode.id)
    if (!couple) continue

    const elkX = elkNode.x || 0
    const elkY = elkNode.y || 0

    couple.cx = elkX + (couple.memberIds.length === 2 ? NODE_W + COUPLE_GAP / 2 : NODE_W / 2)

    couple.memberIds.forEach((id, idx) => {
      const offset = couple.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0

      nodes.push({
        id,
        cx: elkX + offset + NODE_W / 2,
        top: elkY,
        generation: 0,
      })
    })
  }

  return { nodes }
}

function buildCouplesForLayer(
  members: Member[],
  byId: Map<string, Member>,
): Array<{ id: string; memberIds: string[]; cx: number }> {
  const used = new Set<string>()
  const couples: Array<{ id: string; memberIds: string[]; cx: number }> = []

  for (const m of members) {
    if (used.has(m.id)) continue
    const spouse = m.spouses
      .map(s => byId.get(s.id))
      .find(sp => sp && !used.has(sp.id))

    if (spouse) {
      let pair = [m.id, spouse.id]
      if (m.gender === 'female' && spouse.gender === 'male') {
        pair = [spouse.id, m.id]
      }
      used.add(m.id)
      used.add(spouse.id)
      couples.push({
        id: pair.join('|'),
        memberIds: pair,
        cx: 0,
      })
    } else {
      used.add(m.id)
      couples.push({
        id: m.id,
        memberIds: [m.id],
        cx: 0,
      })
    }
  }

  return couples
}

let ELK: any = null

async function getElk() {
  if (!ELK) {
    const elkModule = await import('elkjs')
    ELK = elkModule.default
  }
  return new ELK()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 实现每层 ELK 排列"
```

---

## Task 4: 实现环形坐标计算

**Files:**
- Modify: `src/core/protagonistLayout.ts`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { calculateRingCoordinates } from './protagonistLayout'

describe('calculateRingCoordinates', () => {
  it('主角在中心', () => {
    const layerNodes = new Map([
      [0, [{ id: '1', cx: 0, top: 0, generation: 0 }]],
    ])
    const result = calculateRingCoordinates(layerNodes)
    expect(result.nodes[0].cx).toBe(0)
    expect(result.nodes[0].top).toBe(0)
  })

  it('第 1 层在半径为 BASE_RADIUS 的圆上', () => {
    const layerNodes = new Map([
      [0, [{ id: '1', cx: 0, top: 0, generation: 0 }]],
      [1, [
        { id: '2', cx: 0, top: 0, generation: 0 },
        { id: '3', cx: 2, top: 0, generation: 0 },
      ]],
    ])
    const result = calculateRingCoordinates(layerNodes)
    const BASE_RADIUS = 10
    for (const n of result.nodes) {
      if (n.id !== '1') {
        const dist = Math.sqrt(n.cx * n.cx + n.top * n.top)
        expect(dist).toBeCloseTo(BASE_RADIUS, 0)
      }
    }
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL with "calculateRingCoordinates is not exported"

- [ ] **Step 3: 实现环形坐标计算**

```typescript
// protagonistLayout.ts
const BASE_RADIUS = 10
const RING_GAP = 8

export function calculateRingCoordinates(
  layerNodes: Map<number, LaidOutNode[]>,
): { nodes: LaidOutNode[] } {
  const nodes: LaidOutNode[] = []

  for (const [dist, layer] of layerNodes) {
    if (dist === 0) {
      // 主角在中心
      nodes.push(...layer)
      continue
    }

    const radius = BASE_RADIUS + (dist - 1) * RING_GAP
    const angleStep = (2 * Math.PI) / layer.length

    for (let i = 0; i < layer.length; i++) {
      const angle = i * angleStep - Math.PI / 2 // 从顶部开始
      nodes.push({
        ...layer[i],
        cx: radius * Math.cos(angle),
        top: radius * Math.sin(angle),
      })
    }
  }

  return { nodes }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 实现环形坐标计算"
```

---

## Task 5: 实现连线生成

**Files:**
- Modify: `src/core/protagonistLayout.ts`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { buildProtagonistConnectors } from './protagonistLayout'

describe('buildProtagonistConnectors', () => {
  it('生成配偶连线', () => {
    const nodes: LaidOutNode[] = [
      { id: '1', cx: 0, top: 0, generation: 0 },
      { id: '2', cx: 2, top: 0, generation: 0 },
    ]
    const couples = [{ id: '1|2', memberIds: ['1', '2'], generation: 0, cx: 1 }]
    const byId = new Map<string, Member>()
    byId.set('1', { id: '1', firstName: '', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2' }], godparents: [], godchildren: [] })
    byId.set('2', { id: '2', firstName: '', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1' }], godparents: [], godchildren: [] })

    const connectors = buildProtagonistConnectors(nodes, couples, byId)
    expect(connectors.length).toBe(1)
    expect(connectors[0].kind).toBe('spouse')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL with "buildProtagonistConnectors is not exported"

- [ ] **Step 3: 实现连线生成**

```typescript
// protagonistLayout.ts
import type { Couple, LayoutConnector } from './elkLayout'

export function buildProtagonistConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>,
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 配偶连线
  for (const c of couples) {
    if (c.memberIds.length === 2) {
      const a = nodeById.get(c.memberIds[0])!
      const b = nodeById.get(c.memberIds[1])!
      if (a && b) {
        lines.push({
          kind: 'spouse',
          points: [
            { x: a.cx, y: a.top },
            { x: b.cx, y: b.top },
          ],
        })
      }
    }
  }

  // 父母→子女连线
  for (const c of couples) {
    const childIds = new Set<string>()
    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue
      for (const ch of m.children) childIds.add(ch.id)
    }
    if (childIds.size === 0) continue

    const parentNodes = c.memberIds.map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]
    const childNodes = [...childIds].map(id => nodeById.get(id)).filter(Boolean) as LaidOutNode[]

    if (parentNodes.length === 0 || childNodes.length === 0) continue

    const parentX = parentNodes.length === 2
      ? (parentNodes[0].cx + parentNodes[1].cx) / 2
      : parentNodes[0].cx
    const parentY = parentNodes.length === 2
      ? (parentNodes[0].top + parentNodes[1].top) / 2
      : parentNodes[0].top

    for (const cn of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: parentX, y: parentY },
          { x: cn.cx, y: cn.top },
        ],
      })
    }
  }

  return lines
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 实现连线生成"
```

---

## Task 6: 组合完整布局流程

**Files:**
- Modify: `src/core/protagonistLayout.ts`
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// protagonistLayout.test.ts
import { layoutProtagonist } from './protagonistLayout'

describe('layoutProtagonist', () => {
  it('完整布局流程', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [{ id: '2' }], godparents: [], godchildren: [] },
      { id: '2', firstName: '配偶', lastName: '', gender: 'female', parents: [], children: [], siblings: [], spouses: [{ id: '1' }], godparents: [], godchildren: [] },
      { id: '3', firstName: '父', lastName: '', gender: 'male', parents: [], children: [{ id: '1' }], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    expect(result.nodes.length).toBe(3)
    expect(result.connectors.length).toBeGreaterThan(0)
    // 主角在中心
    const protagonist = result.nodes.find(n => n.id === '1')
    expect(protagonist?.cx).toBeCloseTo(result.canvas.width / 2, 0)
    expect(protagonist?.top).toBeCloseTo(result.canvas.height / 2, 0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现完整布局流程**

```typescript
// protagonistLayout.ts
export async function layoutProtagonist(
  members: Member[],
  protagonistId: string,
): Promise<LayoutResult> {
  if (members.length === 0) {
    return {
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
    }
  }

  const byId = new Map(members.map(m => [m.id, m]))

  // 1. 计算关系距离
  const distances = calcRelationshipDistances(protagonistId, members)

  // 2. 按距离分层
  const layerGroups = groupByDistance(distances)

  // 3. 每层用 ELK 排列
  const layerNodes = new Map<number, LaidOutNode[]>()
  for (const [dist, ids] of layerGroups) {
    const layerMembers = ids.map(id => byId.get(id)).filter(Boolean) as Member[]
    const { nodes } = await layoutLayerWithElk(layerMembers, distances)
    layerNodes.set(dist, nodes)
  }

  // 4. 计算环形坐标
  const { nodes } = calculateRingCoordinates(layerNodes)

  // 5. 生成连线
  const couples = buildCouples(members, byId)
  const connectors = buildProtagonistConnectors(nodes, couples, byId)

  // 6. 计算画布尺寸
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    minY = Math.min(minY, n.top - NODE_H / 2)
    maxY = Math.max(maxY, n.top + NODE_H / 2)
  }

  // 平移到正坐标，主角在画布中心
  const width = maxX - minX + NODE_W * 2
  const height = maxY - minY + NODE_H * 2
  const dx = width / 2
  const dy = height / 2
  for (const n of nodes) {
    n.cx += dx
    n.top += dy
  }
  for (const c of couples) c.cx += dx

  return {
    nodes,
    couples,
    connectors,
    canvas: { width, height },
    orphanIds: [],
    offsetX: dx,
  }
}

function buildCouples(
  members: Member[],
  byId: Map<string, Member>,
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []

  for (const m of members) {
    if (used.has(m.id)) continue
    const spouse = m.spouses
      .map(s => byId.get(s.id))
      .find(sp => sp && !used.has(sp.id))

    if (spouse) {
      let pair = [m.id, spouse.id]
      if (m.gender === 'female' && spouse.gender === 'male') {
        pair = [spouse.id, m.id]
      }
      used.add(m.id)
      used.add(spouse.id)
      couples.push({
        id: pair.join('|'),
        memberIds: pair,
        generation: 0,
        cx: 0,
      })
    } else {
      used.add(m.id)
      couples.push({
        id: m.id,
        memberIds: [m.id],
        generation: 0,
        cx: 0,
      })
    }
  }

  return couples
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: 组合完整布局流程"
```

---

## Task 7: 集成测试

**Files:**
- Test: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 写集成测试**

```typescript
// protagonistLayout.test.ts
describe('集成测试', () => {
  it('大家族布局无重叠', async () => {
    const members: Member[] = [
      // 祖辈
      { id: 'gpa', firstName: '爷爷', lastName: '', gender: 'male', parents: [], children: [{ id: 'dad' }], siblings: [], spouses: [{ id: 'gma' }], godparents: [], godchildren: [] },
      { id: 'gma', firstName: '奶奶', lastName: '', gender: 'female', parents: [], children: [{ id: 'dad' }], siblings: [], spouses: [{ id: 'gpa' }], godparents: [], godchildren: [] },
      // 父辈
      { id: 'dad', firstName: '父', lastName: '', gender: 'male', parents: [{ id: 'gpa' }, { id: 'gma' }], children: [{ id: 'me' }], siblings: [], spouses: [{ id: 'mom' }], godparents: [], godchildren: [] },
      { id: 'mom', firstName: '母', lastName: '', gender: 'female', parents: [], children: [{ id: 'me' }], siblings: [], spouses: [{ id: 'dad' }], godparents: [], godchildren: [] },
      // 主角
      { id: 'me', firstName: '我', lastName: '', gender: 'male', parents: [{ id: 'dad' }, { id: 'mom' }], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, 'me')
    expect(result.nodes.length).toBe(5)

    // 检查无重叠
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i]
        const b = result.nodes[j]
        const dx = Math.abs(a.cx - b.cx)
        const dy = Math.abs(a.top - b.top)
        expect(dx > NODE_W || dy > NODE_H).toBe(true)
      }
    }
  })

  it('主角在画布中心', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    const protagonist = result.nodes.find(n => n.id === '1')
    expect(protagonist?.cx).toBeCloseTo(result.canvas.width / 2, 0)
    expect(protagonist?.top).toBeCloseTo(result.canvas.height / 2, 0)
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/core/protagonistLayout.test.ts
git commit -m "test: 添加集成测试"
```

---

## Task 8: 更新现有测试

**Files:**
- Modify: `src/core/protagonistLayout.test.ts`

- [ ] **Step 1: 更新现有测试**

```typescript
// protagonistLayout.test.ts
describe('布局结果', () => {
  it('返回正确的 LayoutResult 结构', async () => {
    const members: Member[] = [
      { id: '1', firstName: '我', lastName: '', gender: 'male', parents: [], children: [], siblings: [], spouses: [], godparents: [], godchildren: [] },
    ]
    const result = await layoutProtagonist(members, '1')
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('couples')
    expect(result).toHaveProperty('connectors')
    expect(result).toHaveProperty('canvas')
    expect(result).toHaveProperty('orphanIds')
    expect(result).toHaveProperty('offsetX')
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/core/protagonistLayout.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/core/protagonistLayout.test.ts
git commit -m "test: 更新现有测试"
```

---

## Task 9: 最终验证

**Files:**
- None

- [ ] **Step 1: 运行所有测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交最终版本**

```bash
git add -A
git commit -m "feat: 主角视角布局重新设计完成"
```

---

## 验收标准检查

- [ ] 选中人物后可切换到主角视角布局
- [ ] 主角在画布中心
- [ ] 辈分层次清晰（从内到外）
- [ ] 直系亲属在内圈，远亲在外圈
- [ ] 节点不重叠
- [ ] 连线不交叉
- [ ] 配偶同层并排
- [ ] 与"视角"功能（称谓计算）独立

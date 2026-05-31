# 家族树布局引擎重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Current status (2026-05-31):** Implementation is landed on `main` through commit `4316123` and follow-up hardening. The checklist below has been reconciled against the current code: implementation and automated verification steps are complete; Web example smoke QA passed; full Tauri/manual visual QA remains open where explicitly unchecked.

**Goal:** 用 ELK.js 约束布局引擎替换手工 BFS 算法，解决重叠和位置不合理问题；新增以选中人物为中心的树状辐射布局模式

**Architecture:** 
- 功能1：用 elkjs 替换 treeLayout.ts 中的手工排序+repack逻辑，保持接口不变
- 功能2：新增 protagonistLayout.ts，实现以主角为中心的混合布局算法

**Tech Stack:** Vue 3, TypeScript, Pinia, elkjs, Vitest

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/core/elkLayout.ts` | 新增：ELK.js 布局引擎封装 |
| `src/core/elkLayout.test.ts` | 新增：ELK 布局测试 |
| `src/core/protagonistLayout.ts` | 新增：主角视角布局算法 |
| `src/core/protagonistLayout.test.ts` | 新增：主角视角布局测试 |
| `src/core/treeLayout.ts` | 修改：改为调用 elkLayout |
| `src/core/treeLayout.test.ts` | 修改：更新测试 |
| `src/stores/ui.ts` | 修改：新增 centerLayoutId 状态 |
| `src/components/tree/FamilyCanvas.vue` | 修改：支持两种布局模式 |
| `src/pages/TreeView.vue` | 修改：新增"以选中为中心布局"按钮 |
| `package.json` | 修改：添加 elkjs 依赖 |

---

## Task 1: 安装 elkjs 依赖

**Files:**
- Modify: `package.json`

- [x] **Step 1: 安装 elkjs**

```bash
npm install elkjs
```

- [x] **Step 2: 验证安装**

```bash
npm ls elkjs
```

Expected: elkjs 版本显示

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add elkjs dependency"
```

---

## Task 2: 创建 ELK 布局引擎核心模块

**Files:**
- Create: `src/core/elkLayout.ts`
- Create: `src/core/elkLayout.test.ts`

- [x] **Step 1: 写失败测试 — 基本布局功能**

```typescript
// src/core/elkLayout.test.ts
import { describe, it, expect } from 'vitest'
import { layoutWithElk } from './elkLayout'
import type { Member } from './schema'

function makeMember(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
    ...overrides,
  }
}

describe('layoutWithElk', () => {
  it('空成员列表返回空结果', async () => {
    const result = await layoutWithElk([])
    expect(result.nodes).toEqual([])
    expect(result.connectors).toEqual([])
    expect(result.canvas).toEqual({ width: 0, height: 0 })
  })

  it('单个成员布局在原点附近', async () => {
    const members = [makeMember('A')]
    const result = await layoutWithElk(members)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('A')
  })

  it('父母在子女上方', async () => {
    const parent = makeMember('P', { children: [{ id: 'C', type: 'blood' }] })
    const child = makeMember('C', { parents: [{ id: 'P', type: 'blood' }] })
    const result = await layoutWithElk([parent, child])
    
    const pNode = result.nodes.find(n => n.id === 'P')!
    const cNode = result.nodes.find(n => n.id === 'C')!
    expect(pNode.top).toBeLessThan(cNode.top)
  })

  it('配偶在同一行', async () => {
    const husband = makeMember('H', { 
      gender: 'male', 
      spouses: [{ id: 'W', type: 'married' }] 
    })
    const wife = makeMember('W', { 
      gender: 'female', 
      spouses: [{ id: 'H', type: 'married' }] 
    })
    const result = await layoutWithElk([husband, wife])
    
    const hNode = result.nodes.find(n => n.id === 'H')!
    const wNode = result.nodes.find(n => n.id === 'W')!
    expect(hNode.generation).toBe(wNode.generation)
  })

  it('节点不会重叠', async () => {
    // 创建多个同代成员
    const members = Array.from({ length: 5 }, (_, i) => 
      makeMember(`M${i}`)
    )
    const result = await layoutWithElk(members)
    
    // 检查任意两个节点不重叠
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i]
        const b = result.nodes[j]
        const NODE_W = 2
        const NODE_H = 4
        const aLeft = a.cx - NODE_W / 2
        const aRight = a.cx + NODE_W / 2
        const bLeft = b.cx - NODE_W / 2
        const bRight = b.cx + NODE_W / 2
        const aBottom = a.top + NODE_H
        const bBottom = b.top + NODE_H
        
        const overlapping = !(aRight <= bLeft || bRight <= aLeft || aBottom <= b.top || bBottom <= a.top)
        expect(overlapping).toBe(false)
      }
    }
  })
})
```

- [x] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/elkLayout.test.ts
```

Expected: FAIL - "Cannot find module './elkLayout'"

- [x] **Step 3: 实现 elkLayout.ts 核心模块**

```typescript
// src/core/elkLayout.ts
import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'

// 动态导入 elkjs 以减小初始包体积
let ELK: any = null

async function getElk() {
  if (!ELK) {
    const elkModule = await import('elkjs')
    ELK = elkModule.default
  }
  return new ELK()
}

// 节点尺寸（与现有 treeLayout 保持一致）
const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const UNIT_GAP = 1.5
const ROW_GAP = 3
const ROW_HEIGHT = NODE_H + ROW_GAP

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

/**
 * 用 ELK.js 计算家族树布局
 */
export async function layoutWithElk(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> }
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

  // Step 1: 分配代数
  const gen = assignGenerations(members, byId)

  // Step 2: 构建 ELK 图
  const { elkGraph, couples, coupleOfMember } = buildElkGraph(members, byId, gen)

  // Step 3: 调用 ELK 布局
  const elk = await getElk()
  const layouted = await elk.layout(elkGraph)

  // Step 4: 转换 ELK 输出为 LayoutResult
  const result = convertElkResult(layouted, couples, coupleOfMember, gen, members)

  // Step 5: 应用手工位置覆盖
  if (opts?.manualPositions) {
    for (const n of result.nodes) {
      const m = opts.manualPositions[n.id]
      if (m) {
        n.cx = m.cx
        n.top = m.top
      }
    }
  }

  // Step 6: 生成连线
  result.connectors = buildConnectors(result.nodes, couples, byId)

  return result
}

/**
 * 分配代数（与现有算法相同）
 */
function assignGenerations(
  members: Member[],
  byId: Map<string, Member>
): Map<string, number> {
  const gen = new Map<string, number>()

  const bfs = (startId: string, startGen: number) => {
    const queue: string[] = [startId]
    gen.set(startId, startGen)
    while (queue.length > 0) {
      const id = queue.shift()!
      const g = gen.get(id)!
      const m = byId.get(id)
      if (!m) continue
      const push = (otherId: string, otherGen: number) => {
        if (!byId.has(otherId)) return
        if (gen.has(otherId)) return
        gen.set(otherId, otherGen)
        queue.push(otherId)
      }
      for (const p of m.parents) push(p.id, g - 1)
      for (const c of m.children) push(c.id, g + 1)
      for (const s of m.spouses) push(s.id, g)
      for (const s of m.siblings) push(s.id, g)
      for (const p of m.godparents) push(p.id, g - 1)
      for (const c of m.godchildren) push(c.id, g + 1)
    }
  }

  for (const m of members) {
    if (gen.has(m.id)) continue
    const componentSeed = findTopInComponent(m.id, byId) ?? m.id
    bfs(componentSeed, 0)
  }

  return gen
}

function findTopInComponent(
  seedId: string,
  byId: Map<string, Member>
): string | null {
  const seen = new Set<string>([seedId])
  const queue: string[] = [seedId]
  let best: string | null = null
  while (queue.length > 0) {
    const id = queue.shift()!
    const m = byId.get(id)
    if (!m) continue
    if (m.parents.length === 0) {
      if (best === null || id < best) best = id
    }
    for (const r of [...m.parents, ...m.children, ...m.spouses, ...m.siblings, ...m.godparents, ...m.godchildren]) {
      if (!seen.has(r.id) && byId.has(r.id)) {
        seen.add(r.id)
        queue.push(r.id)
      }
    }
  }
  return best
}

/**
 * 构建 ELK 图结构
 */
function buildElkGraph(
  members: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>
): { elkGraph: ElkGraph; couples: Couple[]; coupleOfMember: Map<string, Couple> } {
  // 构建夫妻单元
  const couples = buildCouples(members, byId, gen)
  const coupleOfMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const mid of c.memberIds) {
      coupleOfMember.set(mid, c)
    }
  }

  // 构建 ELK 节点（每个 couple 一个节点）
  const elkNodes: ElkNode[] = couples.map(c => ({
    id: c.id,
    width: c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W,
    height: NODE_H,
  }))

  // 构建 ELK 边（父母 couple → 子女 couple）
  const edges: ElkEdge[] = []
  const edgeSet = new Set<string>()
  
  for (const c of couples) {
    const childIds = new Set<string>()
    for (const mid of c.memberIds) {
      const m = byId.get(mid)
      if (!m) continue
      for (const ch of m.children) childIds.add(ch.id)
    }
    
    for (const childId of childIds) {
      const childCouple = coupleOfMember.get(childId)
      if (!childCouple || childCouple.id === c.id) continue
      const edgeKey = `${c.id}->${childCouple.id}`
      if (edgeSet.has(edgeKey)) continue
      edgeSet.add(edgeKey)
      edges.push({
        id: edgeKey,
        sources: [c.id],
        targets: [childCouple.id],
      })
    }
  }

  const elkGraph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': String(UNIT_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(ROW_GAP),
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: elkNodes,
    edges,
  }

  return { elkGraph, couples, coupleOfMember }
}

/**
 * 构建夫妻单元
 */
function buildCouples(
  members: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []
  const gens = new Map<number, Member[]>()
  
  for (const m of members) {
    const g = gen.get(m.id)!
    if (!gens.has(g)) gens.set(g, [])
    gens.get(g)!.push(m)
  }

  for (const [g, membersInGen] of gens) {
    const sorted = [...membersInGen].sort((a, b) => b.children.length - a.children.length)
    
    for (const m of sorted) {
      if (used.has(m.id)) continue
      const spouseInGen = m.spouses
        .map(s => byId.get(s.id))
        .find(sp => sp && !used.has(sp.id) && gen.get(sp.id) === g)
      
      if (spouseInGen) {
        let pair = [m.id, spouseInGen.id]
        if (m.gender === 'female' && spouseInGen.gender === 'male') {
          pair = [spouseInGen.id, m.id]
        }
        used.add(m.id)
        used.add(spouseInGen.id)
        couples.push({
          id: pair.join('|'),
          memberIds: pair,
          generation: g,
          cx: 0,
        })
      } else {
        used.add(m.id)
        couples.push({
          id: m.id,
          memberIds: [m.id],
          generation: g,
          cx: 0,
        })
      }
    }
  }
  
  return couples
}

/**
 * 转换 ELK 输出为 LayoutResult
 */
function convertElkResult(
  layouted: any,
  couples: Couple[],
  coupleOfMember: Map<string, Couple>,
  gen: Map<string, number>,
  members: Member[]
): LayoutResult {
  const nodes: LaidOutNode[] = []
  const coupleById = new Map(couples.map(c => [c.id, c]))
  const minGen = Math.min(...gen.values())

  // ELK 坐标转换为 cell 坐标
  const elkNodeMap = new Map(layouted.children.map((n: any) => [n.id, n]))

  for (const elkNode of layouted.children) {
    const couple = coupleById.get(elkNode.id)
    if (!couple) continue

    const elkX = (elkNode.x || 0) / 100 // ELK 像素 → cell 单位
    const elkY = (elkNode.y || 0) / 100

    couple.cx = elkX + (couple.memberIds.length === 2 ? NODE_W + COUPLE_GAP / 2 : NODE_W / 2)

    couple.memberIds.forEach((id, idx) => {
      const offset = couple.memberIds.length === 2
        ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
        : 0
      
      nodes.push({
        id,
        cx: elkX + offset + NODE_W / 2,
        top: elkY + (couple.generation - minGen) * ROW_HEIGHT,
        generation: couple.generation,
      })
    })
  }

  // 计算画布尺寸
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }

  const dx = -minX
  for (const n of nodes) n.cx += dx

  return {
    nodes,
    couples,
    connectors: [], // 连线在外部生成
    canvas: { width: maxX - minX, height: maxY },
    orphanIds: [],
    offsetX: dx,
  }
}

/**
 * 生成连线
 */
function buildConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 配偶连线
  for (const c of couples) {
    if (c.memberIds.length === 2) {
      const a = nodeById.get(c.memberIds[0])!
      const b = nodeById.get(c.memberIds[1])!
      const y = a.top + NODE_H / 2
      lines.push({
        kind: 'spouse',
        points: [
          { x: a.cx, y },
          { x: b.cx, y },
        ],
      })
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

    const parentY = parentNodes[0].top + NODE_H
    const parentX = parentNodes.length === 2
      ? (parentNodes[0].cx + parentNodes[1].cx) / 2
      : parentNodes[0].cx
    const childTop = childNodes[0].top
    const midY = (parentY + childTop) / 2

    // 父母到中点
    lines.push({
      kind: 'parent-child',
      points: [
        { x: parentX, y: parentY },
        { x: parentX, y: midY },
      ],
    })

    // 水平线
    const childXs = childNodes.map(n => n.cx)
    const childMin = Math.min(...childXs)
    const childMax = Math.max(...childXs)

    if (childNodes.length >= 2) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: childMin, y: midY },
          { x: childMax, y: midY },
        ],
      })
      if (parentX < childMin - 0.1) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: parentX, y: midY },
            { x: childMin, y: midY },
          ],
        })
      } else if (parentX > childMax + 0.1) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: childMax, y: midY },
            { x: parentX, y: midY },
          ],
        })
      }
    } else if (Math.abs(childNodes[0].cx - parentX) > 0.1) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: Math.min(parentX, childNodes[0].cx), y: midY },
          { x: Math.max(parentX, childNodes[0].cx), y: midY },
        ],
      })
    }

    // 子女从中点下降
    for (const cn of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: cn.cx, y: midY },
          { x: cn.cx, y: cn.top },
        ],
      })
    }
  }

  return lines
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/elkLayout.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/elkLayout.ts src/core/elkLayout.test.ts
git commit -m "feat: add ELK.js layout engine core module"
```

---

## Task 3: 集成 ELK 布局到 treeLayout

**Files:**
- Modify: `src/core/treeLayout.ts`
- Modify: `src/core/treeLayout.test.ts`

- [x] **Step 1: 修改 treeLayout.ts 导出**

将 `layoutFamilyTree` 改为调用 `layoutWithElk`：

```typescript
// src/core/treeLayout.ts
import type { Member } from './schema'
import { layoutWithElk } from './elkLayout'

// 重新导出类型
export type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './elkLayout'

/**
 * 自动布局家族树（使用 ELK.js 约束布局引擎）
 */
export async function layoutFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> }
): Promise<LayoutResult> {
  return layoutWithElk(members, opts)
}
```

- [x] **Step 2: 更新 FamilyCanvas.vue 调用**

```typescript
// src/components/tree/FamilyCanvas.vue 中的 layout computed 需要改为异步
const layout = ref<LayoutResult | null>(null)

watch(() => props.members, async (members) => {
  layout.value = await layoutFamilyTree(members, { manualPositions: props.manualPositions })
}, { immediate: true })

watch(() => props.manualPositions, async () => {
  layout.value = await layoutFamilyTree(props.members, { manualPositions: props.manualPositions })
}, { deep: true })
```

- [x] **Step 3: 运行现有测试**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 4: 手动验证**

启动开发服务器，检查：
- 树状图正常显示
- 节点不重叠
- 连线正常
- 手工拖动功能正常

```bash
npm run dev
```

- [x] **Step 5: Commit**

```bash
git add src/core/treeLayout.ts src/components/tree/FamilyCanvas.vue
git commit -m "feat: integrate ELK.js layout engine"
```

---

## Task 4: 创建主角视角布局算法

**Files:**
- Create: `src/core/protagonistLayout.ts`
- Create: `src/core/protagonistLayout.test.ts`

- [x] **Step 1: 写失败测试**

```typescript
// src/core/protagonistLayout.test.ts
import { describe, it, expect } from 'vitest'
import { layoutProtagonist } from './protagonistLayout'
import type { Member } from './schema'

function makeMember(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    firstName: id,
    lastName: '',
    gender: 'other',
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
    ...overrides,
  }
}

describe('layoutProtagonist', () => {
  it('空成员列表返回空结果', async () => {
    const result = await layoutProtagonist([], 'A')
    expect(result.nodes).toEqual([])
  })

  it('单个成员在中心', async () => {
    const members = [makeMember('A')]
    const result = await layoutProtagonist(members, 'A')
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('A')
  })

  it('主角在画布中心', async () => {
    const parent = makeMember('P', { children: [{ id: 'M', type: 'blood' }] })
    const me = makeMember('M', { parents: [{ id: 'P', type: 'blood' }] })
    const child = makeMember('C', { parents: [{ id: 'M', type: 'blood' }] })
    const members = [parent, me, child]
    
    const result = await layoutProtagonist(members, 'M')
    
    const meNode = result.nodes.find(n => n.id === 'M')!
    const pX = result.nodes.find(n => n.id === 'P')!.cx
    const cX = result.nodes.find(n => n.id === 'C')!.cx
    
    // 主角应该在父母和子女之间
    expect(meNode.cx).toBeGreaterThan(Math.min(pX, cX))
    expect(meNode.cx).toBeLessThan(Math.max(pX, cX))
  })

  it('直系亲属比旁系更靠近主角', async () => {
    // 创建一个大家族
    const grandpa = makeMember('GP', { children: [{ id: 'F', type: 'blood' }, { id: 'U', type: 'blood' }] })
    const father = makeMember('F', { 
      parents: [{ id: 'GP', type: 'blood' }],
      children: [{ id: 'M', type: 'blood' }],
      siblings: [{ id: 'U', type: 'blood' }]
    })
    const uncle = makeMember('U', { 
      parents: [{ id: 'GP', type: 'blood' }],
      siblings: [{ id: 'F', type: 'blood' }]
    })
    const me = makeMember('M', { parents: [{ id: 'F', type: 'blood' }] })
    
    const members = [grandpa, father, uncle, me]
    const result = await layoutProtagonist(members, 'M')
    
    const meNode = result.nodes.find(n => n.id === 'M')!
    const fNode = result.nodes.find(n => n.id === 'F')!
    const uNode = result.nodes.find(n => n.id === 'U')!
    
    // 父亲应该比叔叔更靠近主角
    const distFather = Math.abs(fNode.cx - meNode.cx)
    const distUncle = Math.abs(uNode.cx - meNode.cx)
    expect(distFather).toBeLessThan(distUncle)
  })

  it('配偶在主角旁边', async () => {
    const me = makeMember('M', { spouses: [{ id: 'S', type: 'married' }] })
    const spouse = makeMember('S', { spouses: [{ id: 'M', type: 'married' }] })
    
    const result = await layoutProtagonist([me, spouse], 'M')
    
    const meNode = result.nodes.find(n => n.id === 'M')!
    const sNode = result.nodes.find(n => n.id === 'S')!
    
    // 配偶应该和主角在同一行
    expect(meNode.generation).toBe(sNode.generation)
    // 配偶应该紧挨主角
    expect(Math.abs(meNode.cx - sNode.cx)).toBeLessThan(3)
  })
})
```

- [x] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/protagonistLayout.test.ts
```

Expected: FAIL

- [x] **Step 3: 实现主角视角布局算法**

```typescript
// src/core/protagonistLayout.ts
import type { Member } from './schema'
import type { LayoutResult, LaidOutNode, Couple, LayoutConnector } from './treeLayout'

const NODE_W = 2
const NODE_H = 4
const COUPLE_GAP = 0.2
const ROW_HEIGHT = 7

interface RelationshipInfo {
  distance: number  // BFS 距离
  path: string[]    // 关系路径
}

/**
 * 计算主角到所有人的关系距离
 */
function calcRelationshipDistances(
  protagonistId: string,
  members: Member[]
): Map<string, RelationshipInfo> {
  const byId = new Map(members.map(m => [m.id, m]))
  const distances = new Map<string, RelationshipInfo>()
  
  // BFS 计算最短距离
  const queue: Array<{ id: string; dist: number; path: string[] }> = [
    { id: protagonistId, dist: 0, path: [protagonistId] }
  ]
  distances.set(protagonistId, { distance: 0, path: [protagonistId] })
  
  while (queue.length > 0) {
    const { id, dist, path } = queue.shift()!
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
      
      const newPath = [...path, nextId]
      distances.set(nextId, { distance: dist + 1, path: newPath })
      queue.push({ id: nextId, dist: dist + 1, path: newPath })
    }
  }
  
  return distances
}

/**
 * 分配代数
 */
function assignGenerations(
  members: Member[],
  byId: Map<string, Member>
): Map<string, number> {
  const gen = new Map<string, number>()
  
  const bfs = (startId: string, startGen: number) => {
    const queue: string[] = [startId]
    gen.set(startId, startGen)
    while (queue.length > 0) {
      const id = queue.shift()!
      const g = gen.get(id)!
      const m = byId.get(id)
      if (!m) continue
      const push = (otherId: string, otherGen: number) => {
        if (!byId.has(otherId)) return
        if (gen.has(otherId)) return
        gen.set(otherId, otherGen)
        queue.push(otherId)
      }
      for (const p of m.parents) push(p.id, g - 1)
      for (const c of m.children) push(c.id, g + 1)
      for (const s of m.spouses) push(s.id, g)
      for (const s of m.siblings) push(s.id, g)
    }
  }
  
  // 以主角为起点
  const protagonist = members.find(m => !gen.has(m.id))
  if (protagonist) bfs(protagonist.id, 0)
  
  return gen
}

/**
 * 构建夫妻单元
 */
function buildCouples(
  members: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []
  const gens = new Map<number, Member[]>()
  
  for (const m of members) {
    const g = gen.get(m.id) ?? 0
    if (!gens.has(g)) gens.set(g, [])
    gens.get(g)!.push(m)
  }
  
  for (const [g, membersInGen] of gens) {
    for (const m of membersInGen) {
      if (used.has(m.id)) continue
      const spouseInGen = m.spouses
        .map(s => byId.get(s.id))
        .find(sp => sp && !used.has(sp.id) && gen.get(sp.id) === g)
      
      if (spouseInGen) {
        let pair = [m.id, spouseInGen.id]
        if (m.gender === 'female' && spouseInGen.gender === 'male') {
          pair = [spouseInGen.id, m.id]
        }
        used.add(m.id)
        used.add(spouseInGen.id)
        couples.push({
          id: pair.join('|'),
          memberIds: pair,
          generation: g,
          cx: 0,
        })
      } else {
        used.add(m.id)
        couples.push({
          id: m.id,
          memberIds: [m.id],
          generation: g,
          cx: 0,
        })
      }
    }
  }
  
  return couples
}

/**
 * 主角视角布局
 */
export async function layoutProtagonist(
  members: Member[],
  protagonistId: string
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
  
  // 计算关系距离
  const distances = calcRelationshipDistances(protagonistId, members)
  
  // 分配代数
  const gen = assignGenerations(members, byId)
  const minGen = Math.min(...gen.values())
  const protagonistGen = gen.get(protagonistId) ?? 0
  
  // 构建夫妻单元
  const couples = buildCouples(members, byId, gen)
  const coupleOfMember = new Map<string, Couple>()
  for (const c of couples) {
    for (const mid of c.memberIds) {
      coupleOfMember.set(mid, c)
    }
  }
  
  // 按代分组
  const couplesByGen = new Map<number, Couple[]>()
  for (const c of couples) {
    const g = c.generation
    if (!couplesByGen.has(g)) couplesByGen.set(g, [])
    couplesByGen.get(g)!.push(c)
  }
  
  // 按关系距离排序每代内的夫妻单元
  for (const [g, genCouples] of couplesByGen) {
    genCouples.sort((a, b) => {
      // 主角的夫妻单元排最前
      const aIsProtagonist = a.memberIds.includes(protagonistId)
      const bIsProtagonist = b.memberIds.includes(protagonistId)
      if (aIsProtagonist) return -1
      if (bIsProtagonist) return 1
      
      // 按最小关系距离排序
      const aDist = Math.min(...a.memberIds.map(id => distances.get(id)?.distance ?? Infinity))
      const bDist = Math.min(...b.memberIds.map(id => distances.get(id)?.distance ?? Infinity))
      
      return aDist - bDist
    })
  }
  
  // 分配坐标
  const nodes: LaidOutNode[] = []
  const gens = [...couplesByGen.keys()].sort((a, b) => a - b)
  
  for (const g of gens) {
    const genCouples = couplesByGen.get(g)!
    let x = 0
    
    for (const c of genCouples) {
      const w = c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W
      c.cx = x + w / 2
      
      c.memberIds.forEach((id, idx) => {
        const offset = c.memberIds.length === 2
          ? (idx === 0 ? -(NODE_W + COUPLE_GAP) / 2 : (NODE_W + COUPLE_GAP) / 2)
          : 0
        
        nodes.push({
          id,
          cx: c.cx + offset,
          top: (g - minGen) * ROW_HEIGHT,
          generation: g,
        })
      })
      
      x += w + 1.5 // 间距
    }
  }
  
  // 居中主角
  const protagonistNode = nodes.find(n => n.id === protagonistId)
  if (protagonistNode) {
    const centerX = nodes.reduce((sum, n) => sum + n.cx, 0) / nodes.length
    const dx = centerX - protagonistNode.cx
    for (const n of nodes) n.cx += dx
    for (const c of couples) c.cx += dx
  }
  
  // 计算画布尺寸
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }
  
  const offsetX = -minX
  for (const n of nodes) n.cx += offsetX
  for (const c of couples) c.cx += offsetX
  
  // 生成连线
  const connectors = buildConnectors(nodes, couples, byId)
  
  return {
    nodes,
    couples,
    connectors,
    canvas: { width: maxX - minX, height: maxY },
    orphanIds: [],
    offsetX,
  }
}

function buildConnectors(
  nodes: LaidOutNode[],
  couples: Couple[],
  byId: Map<string, Member>
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  
  // 配偶连线
  for (const c of couples) {
    if (c.memberIds.length === 2) {
      const a = nodeById.get(c.memberIds[0])!
      const b = nodeById.get(c.memberIds[1])!
      const y = a.top + NODE_H / 2
      lines.push({
        kind: 'spouse',
        points: [
          { x: a.cx, y },
          { x: b.cx, y },
        ],
      })
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
    
    const parentY = parentNodes[0].top + NODE_H
    const parentX = parentNodes.length === 2
      ? (parentNodes[0].cx + parentNodes[1].cx) / 2
      : parentNodes[0].cx
    const childTop = childNodes[0].top
    const midY = (parentY + childTop) / 2
    
    lines.push({
      kind: 'parent-child',
      points: [
        { x: parentX, y: parentY },
        { x: parentX, y: midY },
      ],
    })
    
    const childXs = childNodes.map(n => n.cx)
    const childMin = Math.min(...childXs)
    const childMax = Math.max(...childXs)
    
    if (childNodes.length >= 2) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: childMin, y: midY },
          { x: childMax, y: midY },
        ],
      })
    }
    
    for (const cn of childNodes) {
      lines.push({
        kind: 'parent-child',
        points: [
          { x: cn.cx, y: midY },
          { x: cn.cx, y: cn.top },
        ],
      })
    }
  }
  
  return lines
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/protagonistLayout.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/protagonistLayout.ts src/core/protagonistLayout.test.ts
git commit -m "feat: add protagonist-centered layout algorithm"
```

---

## Task 5: 添加 UI 状态管理

**Files:**
- Modify: `src/stores/ui.ts`

- [x] **Step 1: 添加 centerLayoutId 状态**

```typescript
// src/stores/ui.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const viewpointId = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  const searchQuery = ref('')
  const toast = ref<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const canvasView = ref<{ x: number; y: number; scale: number } | null>(null)
  // 新增：主角视角布局 ID
  const centerLayoutId = ref<string | null>(null)

  function setViewpoint(id: string | null) {
    viewpointId.value = id
  }
  function setSelected(id: string | null) {
    selectedId.value = id
  }
  function setSearch(q: string) {
    searchQuery.value = q
  }
  function setCanvasView(v: { x: number; y: number; scale: number } | null) {
    canvasView.value = v
  }
  function showToast(type: 'info' | 'error' | 'success', text: string) {
    toast.value = { type, text }
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        if (toast.value?.text === text) toast.value = null
      }, 3500)
    }
  }
  function clearToast() {
    toast.value = null
  }
  // 新增：设置主角视角布局
  function setCenterLayout(id: string | null) {
    centerLayoutId.value = id
  }

  return {
    viewpointId,
    selectedId,
    searchQuery,
    toast,
    canvasView,
    centerLayoutId,
    setViewpoint,
    setSelected,
    setSearch,
    setCanvasView,
    showToast,
    clearToast,
    setCenterLayout,
  }
})
```

- [x] **Step 2: 运行 typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [x] **Step 3: Commit**

```bash
git add src/stores/ui.ts
git commit -m "feat: add centerLayoutId to UI store"
```

---

## Task 6: 更新 FamilyCanvas 支持两种布局

**Files:**
- Modify: `src/components/tree/FamilyCanvas.vue`

- [x] **Step 1: 添加布局模式 prop**

```typescript
// src/components/tree/FamilyCanvas.vue
const props = defineProps<{
  members: Member[]
  rootId?: string
  selectedId?: string | null
  viewpointId?: string | null
  centerLayoutId?: string | null  // 新增
  getKinship?: (fromId: string, toId: string) => string | null
  manualPositions?: Record<string, { cx: number; top: number }>
  initialView?: PanzoomView | null
}>()
```

- [x] **Step 2: 根据 centerLayoutId 选择布局算法**

```typescript
import { layoutFamilyTree } from '@/core/treeLayout'
import { layoutProtagonist } from '@/core/protagonistLayout'

const layout = ref<LayoutResult | null>(null)

async function updateLayout() {
  if (props.centerLayoutId) {
    layout.value = await layoutProtagonist(props.members, props.centerLayoutId)
  } else {
    layout.value = await layoutFamilyTree(props.members, { manualPositions: props.manualPositions })
  }
}

watch(() => [props.members, props.centerLayoutId, props.manualPositions], updateLayout, { immediate: true, deep: true })
```

- [x] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [x] **Step 4: Commit**

```bash
git add src/components/tree/FamilyCanvas.vue
git commit -m "feat: support protagonist layout in FamilyCanvas"
```

---

## Task 7: 添加 UI 按钮

**Files:**
- Modify: `src/pages/TreeView.vue`

- [x] **Step 1: 添加"以选中为中心布局"按钮**

```vue
<!-- src/pages/TreeView.vue -->
<button
  v-if="selectedId && centerLayoutId !== selectedId"
  class="rounded border border-violet-300 bg-violet-50 px-3 py-1 text-sm text-violet-700 hover:bg-violet-100"
  @click="setCenterLayout"
>
  以选中为中心布局
</button>
<button
  v-if="centerLayoutId"
  class="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
  @click="clearCenterLayout"
>
  退出中心布局
</button>
```

- [x] **Step 2: 添加按钮处理函数**

```typescript
function setCenterLayout() {
  ui.setCenterLayout(selectedId.value)
}

function clearCenterLayout() {
  ui.setCenterLayout(null)
}
```

- [x] **Step 3: 传递 centerLayoutId 给 FamilyCanvas**

```vue
<FamilyCanvas
  :members="membersArray"
  :root-id="rootId"
  :selected-id="selectedId"
  :viewpoint-id="viewpointId"
  :center-layout-id="centerLayoutId"
  :get-kinship="kinshipResolver"
  :manual-positions="family.data.manualPositions"
  :initial-view="ui.canvasView"
  @select="onSelect"
  @open="onOpen"
  @view-change="ui.setCanvasView"
/>
```

- [x] **Step 4: 添加 centerLayoutId 到 storeRefs**

```typescript
const { viewpointId, selectedId, centerLayoutId } = storeToRefs(ui)
```

- [x] **Step 5: 运行 typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/pages/TreeView.vue
git commit -m "feat: add center layout button to TreeView"
```

---

## Task 8: 最终验证

- [x] **Step 1: 运行所有测试**

```bash
npm test
```

Expected: 所有测试通过

- [x] **Step 2: 运行 typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: 手动测试功能 1（ELK 布局）**

启动开发服务器：
```bash
npm run dev
```

测试场景：
- 创建新成员，验证无重叠
- 添加兄弟姐妹，验证自动靠近
- 添加配偶，验证同层并排
- 手工拖动节点，验证位置保存

- [ ] **Step 4: 手动测试功能 2（主角视角）**

测试场景：
- 选中某成员，点击"以选中为中心布局"
- 验证主角在中心
- 验证直系亲属在内圈
- 验证远亲在外圈
- 再次点击"退出中心布局"，回到传统布局

- [x] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete layout engine redesign with ELK.js and protagonist view"
```

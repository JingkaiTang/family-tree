# Root Lineage Grid Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将默认排版升级为“根族连续网格 + 跨根桥接域”：同一根族成员跨代保持聚合，夫妻仍作为不可拆家庭单位，跨根婚姻获得专用位置，任何不同家庭的主关系线都不共享正长度线段；恢复默认布局会清除全部手动排序并聚焦视角人物或整棵树中心。

**Architecture:** 保留现有纯 TypeScript 流水线和 Vue 渲染边界，在 `buildFamilyUnits` 与几何排版之间加入根族语义层。该层从主关系投影视图发现可见根家庭、传播根签名、建立根交互图并划分根域/桥接域；新的域排版器为每个根族分配连续列区间，再在区间内做家庭单位网格布局。路由器以家庭为 route owner，经固定端口和域边界 gateway 独立寻路；交互只写入根顺序、域内行顺序和桥接顺序偏好，不修改亲属关系。

**Tech Stack:** Vue 3、Pinia、TypeScript、Zod、Vitest、SVG、现有 PanZoom/Tauri 运行时。不增加图布局、约束求解或拖拽依赖。

**Design Reference:** `docs/superpowers/specs/2026-07-15-root-lineage-grid-layout-design.md`

---

## Global Constraints

- 根是“可见数据中没有主父代来源的祖先家庭”，不是单个人，也不由 `rootMemberId` 决定。
- 直接嫁入/娶入且没有展开上游祖先的人继承配偶根；双方都有不同可见根时才形成跨根家庭。
- 血缘和当前收养关系参与根签名；历史配偶、继亲、教父母和次要父母关系只进入辅助层。
- 同一根族在每一代占用连续且不可被其他根族插入的列区间；根域之间保留显著留白，不渲染根域背景、标题或“根”标记。
- 当前夫妻始终是一个不可拆 `FamilyUnit`。跨根家庭位于桥接域，卡片顺序按来源根的空间方向确定，不按性别确定。
- 两根稀疏婚配使用两域之间的 bridge band；多根、环状或高密度婚配使用 bridge island。
- 子女根签名是主父母根签名的集合并集；例如 `{A,B} × {B,C}` 的子女是 `{A,B,C}`。
- 同根不同支系结婚仍留在该根域；只有签名包含两个及以上不同根才进入桥接域。
- 不同 `routeOwnerId` 的主关系线可以点交叉，但不得共享正长度线段、形成假 T 接头或穿过卡片；交叉点必须绘制 line bridge。
- 只有同一个 `ParentageGroup.id` 的父代 stem、child bus 和下行支线可以合并。
- 拖拽只改变布局偏好：普通家庭限同根同代，桥接家庭限同桥接域同代，根家庭拖拽会移动整个根域。
- 恢复默认布局清空 `rootOrders`、`rowOrders`、`bridgeOrders`，丢弃 `previousScene`，恢复默认缩放后聚焦有效 `viewpointId`，否则聚焦场景中心。
- `rootMemberId` 只影响断开连通分量的优先放置；`viewpointId` 只影响视图焦点，两者都不改变根发现和布局语义。
- 根族颜色稳定、可区分并贯穿根强调、成员侧边轨和关系线；根向上迁移时优先继承旧根的颜色、顺序和空间位置。
- 相同输入事实、视图策略、偏好、指标和上一场景必须产生确定性相同输出。
- 默认目标为 500 人；保持同步纯函数实现和现有异步 facade，不在本轮引入 Worker。
- 每个任务先写失败测试，再写最小实现；每个任务单独提交，三个验证关口必须全绿后才能继续下一阶段。

---

## Scope Check And Delivery Gates

这是一条严格依赖链，不拆成多个互相漂移的项目计划。实施按以下三个关口推进：

1. **Gate A — 根族语义模型：** Task 1–4。只增加根发现、签名、域模型与 V4 偏好；公开布局行为保持不变。
2. **Gate B — 默认布局与路由：** Task 5–9。切换公开流水线，完成根域网格、桥接域和无重叠线段路由。
3. **Gate C — 视觉、拖拽与硬化：** Task 10–14。完成隐式视觉区分、三种拖拽、全量重置、增量稳定和性能回归。

每个 Gate 结束运行 `npm test && npm run typecheck && npm run build`。Gate B 和 Gate C 额外运行布局 E2E 与 500 人性能验证。

---

## File Structure

### New core files

- `src/core/family-layout/rootSignatures.ts`: 根签名标准化、集合并集和稳定 key。
- `src/core/family-layout/discoverRootFamilies.ts`: 可见根祖先候选、祖先夫妻合并、未展开嫁入/娶入抑制和根迁移匹配。
- `src/core/family-layout/propagateRootSignatures.ts`: 沿主父代关系传播根签名，并为家庭单位生成成员来源根。
- `src/core/family-layout/buildRootDomains.ts`: 根交互图、根域、pair bridge band、multi-root bridge island 和稳定域顺序。
- `src/core/family-layout/assignRootAccents.ts`: 稳定根色、相邻避色和跨根双/多色元数据。
- `src/core/family-layout/decorateRootedUnits.ts`: 把根签名、域、颜色和空间根顺序装饰到基础家庭单位。
- `src/core/family-layout/placeRootDomains.ts`: 连续列区间、域内分支优先网格、跨域桥接家庭位置和增量稳定。
- `src/core/family-layout/rootLayoutTestHelpers.ts`: 根族、跨根、收养、稠密婚配和动态祖先测试夹具。

### Modified core files

- `src/core/family-layout/types.ts`: 根、签名、域、gateway、场景元数据、V4 偏好和诊断类型。
- `src/core/family-layout/buildFamilyUnits.ts`: 输出可被根语义层装饰的基础家庭单位，不在此处猜测根。
- `src/core/family-layout/materializeSceneGeometry.ts`: 接收已排序的成员来源根和域区间，生成卡片/家庭几何。
- `src/core/family-layout/routeFamilyLanes.ts`: 固定端口、域 gateway、route-owner 车道和跨线 bridge。
- `src/core/family-layout/validateScene.ts`: 根域连续性、域内包含、路由共享线段和假 T 硬校验。
- `src/core/family-layout/buildSafeFallbackScene.ts`: fallback 保留域元数据并继续保证卡片不重叠。
- `src/core/family-layout/layoutFamilyScene.ts`: 编排新的根发现、域划分、排版、路由和校验流水线。
- `src/core/family-layout/reconcilePreferences.ts`: V4 根顺序、域内行顺序和桥接顺序清理/迁移。
- `src/core/treeLayout.ts`: 传入 `rootMemberId` 的连通分量提示和新的 V4 偏好。
- `src/core/schema.ts`: schema V4 持久化布局偏好。
- `src/core/migrate.ts`: V3 → V4 迁移和旧 row preference 兼容。
- `src/stores/family.ts`: 三种排序 action 和一次性全量清除 action。

### Modified UI files

- `src/components/tree/MemberNode.vue`: 根色侧边轨与跨根成员自身来源色。
- `src/components/tree/FamilyUnit.vue`: 根家庭强调、同根/跨根夫妻轴和多色边界，不增加根域背景或标题。
- `src/components/tree/RelationLayer.vue`: 根色/家庭色路线和显式 line bridge。
- `src/components/tree/FamilyCanvas.vue`: 域约束拖拽、根域整体漂移预览、桥接域排序和重置协作。
- `src/pages/TreeView.vue`: 全部布局偏好的恢复默认按钮状态和事件绑定。

### Tests and docs

- `src/core/family-layout/*.test.ts`: 每个新纯函数的单元测试。
- `src/core/treeLayout.test.ts`: 公开 facade 和完整场景不变量。
- `src/stores/family.test.ts`: V4 偏好写入、清理和 dirty 语义。
- `src/__tests__/components/FamilyCanvas.test.ts`: 三种拖拽、无效落点、漂移预览和重置。
- `src/__tests__/components/FamilyUnit.test.ts`: 根家庭和跨根夫妻视觉元数据。
- `src/__tests__/pages/TreeView.test.ts`: 恢复默认布局清除全部偏好。
- `src/__tests__/fixtures/families.ts`: 两根、多根、同根婚配、收养、动态祖先和稠密网络夹具。
- `src/__tests__/e2e/scenarios/layout-verification.test.ts`: 根域聚合、卡片/线不干涉、路由 owner 不重线。
- `src/__tests__/performance/layout-performance.test.ts`: 500 人根域布局预算。
- `README.md`: 根族默认布局、拖拽范围和恢复默认语义。

### Removed only after Gate C is green

- `src/core/family-layout/clusterLineages.ts`
- `src/core/family-layout/clusterLineages.test.ts`
- `src/core/family-layout/orderUnits.ts`
- `src/core/family-layout/orderUnits.test.ts`
- `src/core/family-layout/compactGrid.ts`
- `src/core/family-layout/compactGrid.test.ts`

在新公开流水线全绿之前保留旧模块，避免中间提交无法回滚；删除时只删除已无导入的旧实现。

---

### Task 1: Root Signature Types And Deterministic Test Fixtures

**Files:**
- Modify: `src/core/family-layout/types.ts`
- Create: `src/core/family-layout/rootSignatures.ts`
- Create: `src/core/family-layout/rootSignatures.test.ts`
- Create: `src/core/family-layout/rootLayoutTestHelpers.ts`

- [x] **Step 1: 写根签名工具的失败测试**

创建 `src/core/family-layout/rootSignatures.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  mergeRootSignatures,
  normalizeRootSignature,
  rootSignatureKey,
} from './rootSignatures'

describe('rootSignatures', () => {
  it('deduplicates and sorts roots deterministically', () => {
    expect(normalizeRootSignature(['root:b', 'root:a', 'root:b']))
      .toEqual(['root:a', 'root:b'])
  })

  it('merges overlapping signatures as a set union', () => {
    expect(mergeRootSignatures(['root:a', 'root:b'], ['root:b', 'root:c']))
      .toEqual(['root:a', 'root:b', 'root:c'])
  })

  it('uses an unambiguous stable key', () => {
    expect(rootSignatureKey(['root:b', 'root:a']))
      .toBe('root:a|root:b')
  })
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/rootSignatures.test.ts
```

Expected: FAIL，提示 `rootSignatures.ts` 不存在。

- [x] **Step 3: 扩展共享类型**

在 `types.ts` 增加以下类型；保留现有 `FamilyUnit` 作为根语义之前的基础类型：

```ts
export type RootSignature = string[]
export type LayoutDomainKind = 'root' | 'pair-bridge' | 'multi-root-island'

export interface RootFamily {
  id: string
  rootUnitId: string
  seedPersonIds: string[]
  generation: number
  componentId: string
}

export interface RootedFamilyUnit extends FamilyUnit {
  rootSignature: RootSignature
  domainId: string
  memberRootIds: Partial<Record<string, string>>
  rootAccent: string
  isRootFamily: boolean
}

export interface LayoutDomain {
  id: string
  kind: LayoutDomainKind
  componentId: string
  rootIds: string[]
  signature: RootSignature
  personIds: string[]
  unitIds: string[]
  order: number
  accent: string
}

export interface PlacedLayoutDomain extends LayoutDomain {
  rect: Rect
  columnStart: number
  columnEnd: number
}

export interface RootLayoutModel {
  roots: RootFamily[]
  signatureByPersonId: Record<string, RootSignature>
  signatureByUnitId: Record<string, RootSignature>
  sourceRootIdByPersonId: Partial<Record<string, string>>
  domainIdByUnitId: Record<string, string>
  domains: LayoutDomain[]
  diagnostics: LayoutDiagnostic[]
}
```

增加独立内部类型，不立即修改当前公开 `PlacedFamilyUnit` / `SceneGeometry` / `LayoutScene`：

```ts
export interface PlacedRootedFamilyUnit extends RootedFamilyUnit {
  rect: Rect
  order: number
}

export interface RootSceneGeometry {
  units: PlacedRootedFamilyUnit[]
  cards: PlacedPersonCard[]
  hubs: PlacedUnionHub[]
  rows: PlacedRow[]
  rootDomains: PlacedLayoutDomain[]
  bridgeDomains: PlacedLayoutDomain[]
  bounds: Rect
}

export interface RootLayoutScene extends RootSceneGeometry {
  gateways: RouteGateway[]
  routes: RoutedFamilyEdge[]
  diagnostics: LayoutDiagnostic[]
}
```

Task 1 同时声明 `RouteGateway` 的稳定数据形状（`id/domainId/side/point/routeOwnerId`），Task 8 只实现其分配和校验行为。Gate A 的旧流水线继续使用旧 `LayoutScene`，Gate B 的新纯函数使用上述严格类型；不能把根字段做成 optional，因为那会让旧/新流水线静默混用。Task 9 切换 facade 返回类型，Task 14 删除旧引擎后再把 `RootLayoutScene` 收敛回唯一的 `LayoutScene` 名称。

在 `LayoutMetrics` 和默认值增加：

```ts
rootGap: number
bridgeGap: number
```

默认值：

```ts
rootGap: 144,
bridgeGap: 96,
```

- [x] **Step 4: 实现签名工具**

创建 `rootSignatures.ts`：

```ts
import type { RootSignature } from './types'

export function normalizeRootSignature(rootIds: Iterable<string>): RootSignature {
  return [...new Set(rootIds)].sort((left, right) => left.localeCompare(right))
}

export function mergeRootSignatures(
  ...signatures: RootSignature[]
): RootSignature {
  return normalizeRootSignature(signatures.flat())
}

export function rootSignatureKey(signature: RootSignature): string {
  return normalizeRootSignature(signature).join('|')
}
```

- [x] **Step 5: 创建共享根族夹具**

`rootLayoutTestHelpers.ts` 必须导出以下确定性夹具，全部复用现有 `testHelpers.ts` 的 `member`、`linkParent`、`linkSpouse` 和 `buildProjectedInput`：

```ts
export function twoRootMarriageFixture(): RootFixture
export function unequalDepthMarriageFixture(): RootFixture
export function sameRootCousinMarriageFixture(): RootFixture
export function denseThreeRootFixture(): RootFixture
export function adoptedPrimaryFixture(): RootFixture
export function incomingSpouseFixture(): RootFixture
```

`RootFixture` 精确包含：

```ts
export interface RootFixture {
  projected: ProjectedFamily
  units: FamilyUnit[]
  parentageGroups: ParentageGroup[]
  generationByUnitId: Record<string, number>
}
```

每个 fixture 使用固定成员 ID，不使用随机 UUID；`unequalDepthMarriageFixture` 必须让 A 根记录三代、B 根只记录一代，防止错误地把全局最小 generation 当成唯一根判据。

- [x] **Step 6: 更新现有场景构造器并验证 GREEN**

运行：

```bash
npm test -- src/core/family-layout/rootSignatures.test.ts
npm run typecheck
```

Expected: PASS，且旧公开布局类型和测试不需要兼容性假数据。

- [x] **Step 7: 提交基础类型**

```bash
git add src/core/family-layout/types.ts src/core/family-layout/rootSignatures.ts src/core/family-layout/rootSignatures.test.ts src/core/family-layout/rootLayoutTestHelpers.ts
git commit -m "refactor: add root lineage layout types"
```

---

### Task 2: Discover Visible Root Families

**Files:**
- Create: `src/core/family-layout/discoverRootFamilies.ts`
- Create: `src/core/family-layout/discoverRootFamilies.test.ts`
- Modify: `src/core/family-layout/types.ts`

- [x] **Step 1: 写根发现失败测试**

创建测试覆盖四个判据：祖先夫妻合并为一个根、直接嫁入/娶入者不生成第二根、不同记录深度仍发现两个根、断开分量各自生成根。

```ts
import { describe, expect, it } from 'vitest'
import {
  incomingSpouseFixture,
  twoRootMarriageFixture,
  unequalDepthMarriageFixture,
} from './rootLayoutTestHelpers'
import { discoverRootFamilies } from './discoverRootFamilies'

describe('discoverRootFamilies', () => {
  it('groups a source couple into one visible root family', () => {
    const fixture = twoRootMarriageFixture()
    const result = discoverRootFamilies(fixture)

    expect(result.roots.map(root => root.seedPersonIds)).toContainEqual(['a0', 'a0-spouse'])
  })

  it('suppresses an unexpanded incoming spouse as an independent root', () => {
    const fixture = incomingSpouseFixture()
    const result = discoverRootFamilies(fixture)

    expect(result.roots).toHaveLength(1)
    expect(result.suppressedIncomingPersonIds).toEqual(['incoming'])
  })

  it('does not use the global minimum generation as the root criterion', () => {
    const fixture = unequalDepthMarriageFixture()
    const result = discoverRootFamilies(fixture)

    expect(result.roots.map(root => root.id).sort()).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
  })
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/discoverRootFamilies.test.ts
```

Expected: FAIL，提示 `discoverRootFamilies` 不存在。

- [x] **Step 3: 定义发现结果和稳定根 ID**

在 `types.ts` 增加：

```ts
export interface RootDiscoveryResult {
  roots: RootFamily[]
  seedRootIdByPersonId: Record<string, string>
  suppressedIncomingPersonIds: string[]
  diagnostics: LayoutDiagnostic[]
}
```

根 ID 规则固定为 `root:` 加按字典序排序的 seed person ID，以 `+` 连接。根 ID 不包含 generation、卡片位置或 `rootMemberId`。

- [x] **Step 4: 实现来源候选与嫁入/娶入抑制**

实现步骤必须按此顺序：

1. 只读取 `projected.primaryParentages` 中 child type 为 `blood` 或 `adopted` 的关系，建立 `primaryParentIdsByChild` 和 `primaryChildIdsByParent`；`step` 不进入根发现。
2. source candidate 是没有上述主父代来源的人；generation 仅用于排序，不参与 candidate 判定。
3. 若 source candidate 的当前配偶有主父代来源，且该 candidate 的所有主子女都与该配偶共享父代组，则把 candidate 标记为 `suppressedIncomingPersonIds`。
4. 仍为 candidate 且互为当前配偶的两人合成一个 root seed；其余 candidate 各自成 seed。
5. `rootUnitId` 使用包含 seed 的当前 `FamilyUnit.id`；若两个不同根 seed 暂时落在同一跨根家庭单位，允许共享 `rootUnitId`，但 `seedPersonIds` 和 root ID 仍保持独立。
6. 通过主父代和当前配偶构建可见主图连通分量，生成稳定 `componentId`。
7. 所有数组和对象键按稳定 ID 排序后返回。

嫁入/娶入判定函数写成独立纯函数并直接测试：

```ts
export function isUnexpandedIncomingSpouse(input: {
  personId: string
  partnerId: string
  parentIdsByChild: ReadonlyMap<string, string[]>
  childIdsByParent: ReadonlyMap<string, string[]>
  parentageByChild: ReadonlyMap<string, string>
}): boolean
```

没有子女的 source spouse 若其当前配偶已经有可见主父代来源，仍视为未展开 incoming spouse 并继承配偶根。只有该 source person 存在不与当前配偶共享的主子女分支时，才保留为独立根候选。

- [x] **Step 5: 验证根发现与确定性**

```bash
npm test -- src/core/family-layout/discoverRootFamilies.test.ts
npm test -- src/core/family-layout
```

Expected: PASS；将输入成员、partnership 和 parentage 顺序反转后，根结果仍深度相等。

- [x] **Step 6: 提交根发现**

```bash
git add src/core/family-layout/discoverRootFamilies.ts src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/types.ts
git commit -m "feat: discover visible root families"
```

---

### Task 3: Propagate Root Signatures And Classify Units

**Files:**
- Create: `src/core/family-layout/propagateRootSignatures.ts`
- Create: `src/core/family-layout/propagateRootSignatures.test.ts`
- Modify: `src/core/family-layout/types.ts`

- [x] **Step 1: 写签名传播失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { discoverRootFamilies } from './discoverRootFamilies'
import { propagateRootSignatures } from './propagateRootSignatures'
import {
  adoptedPrimaryFixture,
  sameRootCousinMarriageFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('propagateRootSignatures', () => {
  it('creates a joint signature for a cross-root family and its children', () => {
    const fixture = twoRootMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByUnitId['unit:partnership:current:a2+b1']).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
    expect(result.signatureByPersonId['cross-child']).toEqual([
      'root:a0+a0-spouse',
      'root:b0+b0-spouse',
    ])
  })

  it('keeps a same-root cousin marriage inside one root signature', () => {
    const fixture = sameRootCousinMarriageFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByUnitId['unit:partnership:current:left-cousin+right-cousin'])
      .toEqual(['root:a0+a0-spouse'])
  })

  it('follows the adoptive root for primary adopted parentage', () => {
    const fixture = adoptedPrimaryFixture()
    const roots = discoverRootFamilies(fixture)
    const result = propagateRootSignatures({ ...fixture, roots })

    expect(result.signatureByPersonId.adopted).toEqual(['root:adoptive-a+adoptive-b'])
  })
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/propagateRootSignatures.test.ts
```

Expected: FAIL，提示模块不存在。

- [x] **Step 3: 实现单调集合传播**

实现固定点算法，且只读取已经投影为主关系的 `primaryParentages` 和 `primaryPartnerships`：

```ts
export function propagateRootSignatures(
  input: PropagateRootSignaturesInput,
): RootSignatureResult {
  const signatures = seedSignatures(input.projected.people, input.roots)
  const maxPasses = input.projected.people.length + 1

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false
    for (const parentage of stableParentages(input.projected.primaryParentages)) {
      const inherited = mergeRootSignatures(
        ...parentage.parentIds.map(parentId => signatures[parentId] ?? []),
      )
      for (const childId of parentage.childIds) {
        if (parentage.typeByChildId[childId] === 'step') continue
        changed = mergeIntoPerson(signatures, childId, inherited) || changed
      }
    }
    changed = inheritSuppressedIncomingSpouses(signatures, input) || changed
    if (!changed) break
  }

  return materializeSignatureResult(signatures, input)
}
```

约束：

- `blood` 和当前选择为 primary 的 `adopted` parentage 传播；`step` 不传播。
- 被 Task 2 抑制且自身签名为空的 incoming spouse 才继承配偶签名。
- 双方已有不同非空签名时不相互吞并，家庭单位签名取双方并集。
- `sourceRootIdByPersonId` 对单根人物取唯一根；跨根人物根据其父代来源记录最接近的确定性根，无法唯一归属时留空，不按性别猜测。
- fixed-point 超出 `people.length + 1` 仍变化时，返回已有 `PARENTAGE_CYCLE` 诊断，不无限循环。

- [x] **Step 4: 增加重叠签名边缘测试**

补充 `{A,B} × {B,C}` fixture，断言子女为 `{A,B,C}`，且 `secondary-parentage`、历史配偶和教父母不改变任何签名。再补充输入顺序反转的确定性断言。

- [x] **Step 5: 验证 GREEN**

```bash
npm test -- src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/propagateRootSignatures.test.ts
npm run typecheck
```

Expected: PASS。

- [x] **Step 6: 提交签名传播**

```bash
git add src/core/family-layout/propagateRootSignatures.ts src/core/family-layout/propagateRootSignatures.test.ts src/core/family-layout/types.ts src/core/family-layout/rootLayoutTestHelpers.ts
git commit -m "feat: propagate root lineage signatures"
```

---

### Task 4: Persist V4 Layout Preferences And Reconcile Stale IDs

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/migrate.ts`
- Modify: `src/core/migrate.test.ts`
- Modify: `src/core/family-layout/types.ts`
- Modify: `src/core/family-layout/reconcilePreferences.ts`
- Modify: `src/core/family-layout/reconcilePreferences.test.ts`
- Modify: `src/core/family-layout/orderUnits.test.ts`
- Modify: `src/core/treeLayout.ts`
- Modify: `src/stores/family.ts`
- Modify: `src/stores/family.test.ts`
- Modify: `src/__tests__/pages/TreeView.test.ts`

- [x] **Step 1: 写 V3 → V4 迁移失败测试**

在 `migrate.test.ts` 增加：

```ts
it('migrates a v3 sibling row into its v4 root domain', () => {
  const parentA = member('parent-a')
  const parentB = member('parent-b')
  const childA = member('child-a')
  const childB = member('child-b')
  linkSpouse(parentA, parentB)
  linkParent(childA, parentA)
  linkParent(childA, parentB)
  linkParent(childB, parentA)
  linkParent(childB, parentB)

  const migrated = migrate({
    ...createEmptyFamily(),
    schemaVersion: 3,
    members: Object.fromEntries(
      [parentA, parentB, childA, childB].map(value => [value.id, value]),
    ),
    layoutPreferences: {
      rowOrders: [{
        id: 'row:1',
        unitIds: ['unit:person:child-b', 'unit:person:child-a'],
      }],
      familyAccentAssignments: { 'unit:person:child-a': '#123456' },
    },
  })

  expect(migrated.schemaVersion).toBe(4)
  expect(migrated.layoutPreferences).toEqual({
    rootOrders: [],
    rowOrders: [{
      id: 'row:1',
      domainId: 'domain:root:parent-a+parent-b',
      generation: 1,
      unitIds: ['unit:person:child-b', 'unit:person:child-a'],
    }],
    bridgeOrders: [],
    rootAccentAssignments: {},
    familyAccentAssignments: { 'unit:person:child-a': '#123456' },
  })
})
```

- [x] **Step 2: 写 Store 全量清除失败测试**

```ts
it('clears every manual layout order and preserves accent assignments', () => {
  const family = useFamilyStore()
  family.$patch(state => {
    state.data.layoutPreferences = {
      rootOrders: [{ componentId: 'component:a', rootIds: ['root:b', 'root:a'] }],
      rowOrders: [{
        id: 'root:a:0',
        domainId: 'domain:root:a',
        generation: 0,
        unitIds: ['unit:b', 'unit:a'],
      }],
      bridgeOrders: [{
        id: 'bridge:a+b:1',
        domainId: 'domain:bridge:a+b',
        generation: 1,
        unitIds: ['unit:cross-2', 'unit:cross-1'],
      }],
      rootAccentAssignments: { 'root:a': '#345678' },
      familyAccentAssignments: { 'unit:a': '#123456' },
    }
  })

  family.clearAllLayoutOrderPreferences()

  expect(family.data.layoutPreferences).toMatchObject({
    rootOrders: [],
    rowOrders: [],
    bridgeOrders: [],
    rootAccentAssignments: { 'root:a': '#345678' },
    familyAccentAssignments: { 'unit:a': '#123456' },
  })
})
```

- [x] **Step 3: 运行测试并确认 RED**

```bash
npm test -- src/core/migrate.test.ts src/stores/family.test.ts
```

Expected: FAIL，schema 仍为 V3，且全量清除 action 不存在。

- [x] **Step 4: 定义 V4 schema**

将 `SCHEMA_VERSION` 改为 `4`，并定义：

```ts
export const RootOrderPreference = z.object({
  componentId: z.string().min(1),
  rootIds: z.array(z.string().min(1)),
})

export const RowOrderPreference = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1),
  generation: z.number().int(),
  unitIds: z.array(z.string().min(1)),
})

export const BridgeOrderPreference = RowOrderPreference

export type RootOrderPreference = z.infer<typeof RootOrderPreference>
export type RowOrderPreference = z.infer<typeof RowOrderPreference>
export type BridgeOrderPreference = z.infer<typeof BridgeOrderPreference>

export const PersistedLayoutPreferences = z.object({
  rootOrders: z.array(RootOrderPreference).default([]),
  rowOrders: z.array(RowOrderPreference).default([]),
  bridgeOrders: z.array(BridgeOrderPreference).default([]),
  rootAccentAssignments: z.record(z.string()).default({}),
  familyAccentAssignments: z.record(z.string()).default({}),
})
```

同步 `LayoutPreferences`，不要在 core 层重新定义不一致的字段形状。

- [x] **Step 5: 实现显式 V3 → V4 迁移**

在迁移 switch 中只把 V3 row ID 可解析出的 generation 写入 V4；解析失败时使用 `0`，`domainId` 写 `legacy`。新数组为空，颜色原样保留。V4 parser 继续拒绝损坏对象，不静默丢字段。

- [x] **Step 6: 实现偏好写入和清理函数**

`reconcilePreferences.ts` 增加：

```ts
export function withRootOrderPreference(
  data: FamilyData,
  componentId: string,
  rootIds: string[],
): FamilyData

export function withDomainRowOrderPreference(
  data: FamilyData,
  preference: RowOrderPreference,
): FamilyData

export function withBridgeOrderPreference(
  data: FamilyData,
  preference: BridgeOrderPreference,
): FamilyData

export function withoutManualLayoutOrders(data: FamilyData): FamilyData
```

`reconcileLayoutPreferences` 规则：

- 去掉不存在的 unit/root；保留仍存在 ID 的相对顺序。
- 一个 unit 只能出现在同一 `domainId + generation` 的一个 preference 中。
- 长度小于 2 的排序 preference 删除。
- 旧 `domainId: legacy` 若全部有效 unit 属于同一根域，则在 Gate A 转为实际 `domainId + generation`；跨多个根域的旧行暂时保留为 `legacy`，确保 Task 9 切换新引擎前旧排序行为不变。Task 9 再把其中的根间顺序转换为 root order，并删除无法安全归属的残项。
- 颜色 assignment 只删除不存在的 family/root ID，不重新着色。

`buildCurrentLayoutState` 在现有 normalize/project/build/generation 之后调用 Task 2–3 的根发现与签名传播，再按真实 `domainId + generation` 转换 `legacy` row。`treeLayout.ts` 的 `toLayoutPreferences` 复制全部五个字段；Task 9 之前旧 order engine 仍只读取 `rowOrders` 和 family accent，多出的 V4 字段不改变公开坐标。

把现有 `LayoutPreferences` 测试字面量补齐空 `rootOrders`、`bridgeOrders`、`rootAccentAssignments`，并给 row item 补上真实或 `legacy` domain/generation。只做类型兼容，不改旧 order 测试期望。

- [x] **Step 7: 更新 Store actions**

新增并导出：

```ts
setRootOrderPreference(componentId: string, rootIds: string[]): void
setDomainRowOrderPreference(preference: RowOrderPreference): void
setBridgeOrderPreference(preference: BridgeOrderPreference): void
clearAllLayoutOrderPreferences(): void
```

`clearRowOrderPreferences` 暂时保留为兼容包装，内部调用 `clearAllLayoutOrderPreferences`；Task 12 更新所有调用点后删除包装。仅当内容实际变化时 `markDirty()`。

- [x] **Step 8: 验证 Gate A**

```bash
npm test -- src/core/family-layout/rootSignatures.test.ts src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/propagateRootSignatures.test.ts src/core/family-layout/reconcilePreferences.test.ts src/core/migrate.test.ts src/core/treeLayout.test.ts src/stores/family.test.ts src/__tests__/pages/TreeView.test.ts
npm test
npm run typecheck
npm run build
```

Expected: 全部 PASS；生产公开布局快照与 Task 1 前一致。

- [x] **Step 9: 提交 V4 偏好**

```bash
git add src/core/schema.ts src/core/migrate.ts src/core/migrate.test.ts src/core/family-layout/types.ts src/core/family-layout/reconcilePreferences.ts src/core/family-layout/reconcilePreferences.test.ts src/core/family-layout/orderUnits.test.ts src/core/treeLayout.ts src/stores/family.ts src/stores/family.test.ts src/__tests__/pages/TreeView.test.ts
git commit -m "feat: persist root domain layout preferences"
```

---

### Task 5: Assign Stable Root Accents

**Files:**
- Create: `src/core/family-layout/assignRootAccents.ts`
- Create: `src/core/family-layout/assignRootAccents.test.ts`
- Modify: `src/core/family-layout/types.ts`
- Modify: `src/core/family-layout/rootLayoutTestHelpers.ts`

- [x] **Step 1: 写稳定颜色和成员来源顺序失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { assignRootAccents } from './assignRootAccents'
import {
  rootAccentInputAfterAddingAncestor,
  rootAccentInputForFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('assignRootAccents', () => {
  it('keeps adjacent roots distinguishable and deterministic', () => {
    const input = rootAccentInputForFixture(twoRootMarriageFixture())
    const first = assignRootAccents(input)
    const second = assignRootAccents(input)

    expect(second).toEqual(first)
    expect(first['root:a0+a0-spouse']).not.toBe(first['root:b0+b0-spouse'])
  })

  it('inherits the previous accent when a newly added ancestor moves the root upward', () => {
    const result = assignRootAccents(rootAccentInputAfterAddingAncestor())

    expect(result['root:new-a0+new-a0-spouse']).toBe('#4F7CAC')
  })

})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/assignRootAccents.test.ts
```

Expected: FAIL，提示模块不存在。

- [x] **Step 3: 实现根色分配**

使用固定、色盲相对友好的 10 色调色板；不运行时生成随机颜色：

```ts
const ROOT_ACCENT_PALETTE = [
  '#4F7CAC', '#B56576', '#4C956C', '#C17C3A', '#7A6FAE',
  '#2A9D8F', '#9C6644', '#6D597A', '#3D7188', '#A26769',
] as const
```

`assignRootAccents` 只消费 roots、person/unit signatures、偏好和 previous scene，不依赖尚未创建的 layout domains。它从多根 unit signatures 派生根邻接关系。颜色优先级严格为：

1. `preferences.rootAccentAssignments[rootId]`；
2. 与新根 seed/person 后代重叠最大的 `previousScene.rootDomains` 颜色；
3. 同一主图连通分量内避开左右相邻已分配颜色的稳定 hash 选择；
4. 冲突仍不可避免时允许复用，但相邻根不得相同。

根迁移匹配以旧/新根后代 person ID 的 Jaccard 相似度为主，seed 上下游包含关系为次，稳定 root ID 为最终 tie-break。低于 `0.5` 不继承，避免把颜色错误交给无关根。

- [x] **Step 4: 验证颜色确定性和迁移继承**

```bash
npm test -- src/core/family-layout/assignRootAccents.test.ts
npm run typecheck
```

Expected: PASS；输入顺序反转后 accent map 相等，新根匹配阈值测试通过。

- [x] **Step 5: 提交根色分配**

```bash
git add src/core/family-layout/assignRootAccents.ts src/core/family-layout/assignRootAccents.test.ts src/core/family-layout/types.ts src/core/family-layout/rootLayoutTestHelpers.ts
git commit -m "feat: assign stable root lineage accents"
```

---

### Task 6: Build Root Interaction Graph, Layout Domains, And Rooted Units

**Files:**
- Create: `src/core/family-layout/buildRootDomains.ts`
- Create: `src/core/family-layout/buildRootDomains.test.ts`
- Create: `src/core/family-layout/decorateRootedUnits.ts`
- Create: `src/core/family-layout/decorateRootedUnits.test.ts`
- Modify: `src/core/family-layout/types.ts`
- Modify: `src/core/family-layout/rootLayoutTestHelpers.ts`

- [x] **Step 1: 写根域和桥接域失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { buildRootDomains } from './buildRootDomains'
import {
  denseThreeRootFixture,
  rootDomainInputForFixture,
  sameRootCousinMarriageFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('buildRootDomains', () => {
  it('keeps single-root units in one root domain', () => {
    const result = buildRootDomains(rootDomainInputForFixture(sameRootCousinMarriageFixture()))

    expect(result.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'domain:root:a0+a0-spouse',
        kind: 'root',
        rootIds: ['root:a0+a0-spouse'],
      }),
    ]))
    expect(result.domains.some(domain => domain.kind !== 'root')).toBe(false)
  })

  it('uses a pair bridge band for a sparse two-root marriage', () => {
    const result = buildRootDomains(rootDomainInputForFixture(twoRootMarriageFixture()))

    expect(result.domains).toContainEqual(expect.objectContaining({
      id: 'domain:bridge:root:a0+a0-spouse|root:b0+b0-spouse',
      kind: 'pair-bridge',
    }))
  })

  it('uses one multi-root island for a dense cyclic network', () => {
    const result = buildRootDomains(rootDomainInputForFixture(denseThreeRootFixture()))

    expect(result.domains.filter(domain => domain.kind === 'multi-root-island'))
      .toHaveLength(1)
  })
})
```

创建 `decorateRootedUnits.test.ts` 增加来源根空间顺序断言：

```ts
import { describe, expect, it } from 'vitest'
import { decorateRootedUnits } from './decorateRootedUnits'
import {
  preparedRootDomains,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('decorateRootedUnits', () => {
it('orders a cross-root couple by source root position', () => {
  const prepared = preparedRootDomains(twoRootMarriageFixture(), {
    rootOrder: ['root:b0+b0-spouse', 'root:a0+a0-spouse'],
  })
  const units = decorateRootedUnits(prepared)

  expect(units.find(unit => unit.id === 'unit:partnership:current:a2+b1')?.memberIds)
    .toEqual(['b1', 'a2'])
})
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/buildRootDomains.test.ts src/core/family-layout/decorateRootedUnits.test.ts
```

Expected: FAIL，提示模块不存在。

- [x] **Step 3: 构建加权根交互图**

新增内部结构：

```ts
interface RootInteractionEdge {
  id: string
  leftRootId: string
  rightRootId: string
  weight: number
  unitIds: string[]
}
```

每个签名长度大于 1 的家庭单位，对签名中每一对 root 增加权重：当前夫妻单位 `+4`，共同后代单位 `+2`，只因签名继承出现 `+1`。同一单位对同一 root pair 只计一次。

连接分量分类：

- 两个 root、仅一条边、跨根 unit 数不超过 3：每个精确 pair signature 一个 `pair-bridge`。
- root 数大于 2，或边数 `>= rootCount`，或任一 root degree `>= 3`：整个连通分量的多根 unit 进入一个 `multi-root-island`。
- `{A,B,C}` 单位直接触发 multi-root island。
- 单根 signature 的 unit 永远进入对应 root domain，包括同根不同支系婚姻。

- [x] **Step 4: 实现稳定根顺序**

顺序优先级：

1. 同 component 的 `preferences.rootOrders` 中仍有效 root 的相对顺序；
2. `previousScene.rootDomains` 的 x 顺序；
3. 最小化跨根边长度的确定性相邻交换；
4. root ID 字典序 tie-break。

启发式从稳定种子顺序开始，最多进行 `rootCount * rootCount` 次相邻交换。只有目标函数严格下降才交换；相等不交换，以保证增量稳定。

断开 component 的顺序先按是否包含 `request.preferredComponentPersonId`，再按上一场景 x，最后按 component ID。这个字段由 `rootMemberId` 映射而来，只能影响 component 顺序。

- [x] **Step 5: 放置 bridge domain 的逻辑顺序**

- pair bridge 插在它两个 source root domain 之间，并靠近权重更高的交界侧。
- multi-root island 紧跟其根 interaction component，内部 unit 顺序由 `bridgeOrders` 和稳定 barycenter 决定。
- bridge domain 不是任何 root domain 的子域，不能破坏 root domain 连续区间。
- `domainIdByUnitId` 必须覆盖每个 unit 恰好一次；重复或缺失立即产生 `INVALID_ROOT_DOMAIN_ASSIGNMENT` 诊断。

在 `LayoutDiagnosticCode` 增加：

```ts
| 'INVALID_ROOT_DOMAIN_ASSIGNMENT'
| 'ROOT_DOMAIN_INTRUSION'
```

Task 9 切换公开流水线时把两者列入 unsafe codes，因为错误域归属会导致卡片混杂。

- [x] **Step 6: 装饰基础家庭单位**

`decorateRootedUnits` 接收基础 units、签名结果、domains、accent map 和 root order，输出 `RootedFamilyUnit[]`。规则：

- 单根家庭：`rootAccent` 等于唯一根色。
- 跨根家庭：`rootAccent` 是签名第一个空间根的颜色；完整颜色顺序通过 `memberRootIds` 和 domain signature 提供给 UI。
- `isRootFamily` 仅当 unit 是某个 root 的 `rootUnitId` 且 unit 不是跨根 bridge unit。
- 跨根夫妻 `memberIds` 按成员唯一来源根在 `rootOrder` 中的位置排序；未知来源保持原稳定 ID 顺序。
- 同根夫妻保持原有稳定成员顺序，不因根色改变。
- `accent` 继续表示家庭 route owner 色；优先保留 `familyAccentAssignments`，否则从根色派生稳定的明暗变体。

`buildFamilyUnits` 仍只构建基础 `FamilyUnit`。不要把根发现塞进该函数，防止语义层循环依赖。

- [x] **Step 7: 验证 GREEN**

```bash
npm test -- src/core/family-layout/buildRootDomains.test.ts src/core/family-layout/decorateRootedUnits.test.ts src/core/family-layout/buildFamilyUnits.test.ts
npm run typecheck
```

Expected: PASS；输入顺序反转不改变 domains 和 root order。

- [x] **Step 8: 提交域模型和 rooted units**

```bash
git add src/core/family-layout/buildRootDomains.ts src/core/family-layout/buildRootDomains.test.ts src/core/family-layout/decorateRootedUnits.ts src/core/family-layout/decorateRootedUnits.test.ts src/core/family-layout/types.ts src/core/family-layout/rootLayoutTestHelpers.ts
git commit -m "feat: build root and bridge layout domains"
```

---

### Task 7: Place Continuous Root Domains On The Grid

**Files:**
- Create: `src/core/family-layout/placeRootDomains.ts`
- Create: `src/core/family-layout/placeRootDomains.test.ts`
- Modify: `src/core/family-layout/materializeSceneGeometry.ts`
- Modify: `src/core/family-layout/materializeSceneGeometry.test.ts`
- Modify: `src/core/family-layout/types.ts`
- Modify: `src/core/family-layout/rootLayoutTestHelpers.ts`

- [x] **Step 1: 写连续列域失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { placeRootDomains } from './placeRootDomains'
import {
  centerX,
  preparedAsymmetricRootLayout,
  preparedTwoRootLayout,
  rectContains,
} from './rootLayoutTestHelpers'

describe('placeRootDomains', () => {
  it('allocates non-interleaving root intervals with visible whitespace', () => {
    const result = placeRootDomains(preparedTwoRootLayout())
    const [left, right] = result.rootDomains

    expect(left.columnEnd).toBeLessThan(right.columnStart)
    expect(right.rect.x - (left.rect.x + left.rect.width)).toBeGreaterThanOrEqual(144)
    expect(result.units.every(unit => {
      const domain = [...result.rootDomains, ...result.bridgeDomains]
        .find(value => value.id === unit.domainId)!
      return unit.rect.x >= domain.rect.x
        && unit.rect.x + unit.rect.width <= domain.rect.x + domain.rect.width
    })).toBe(true)
  })

  it('centers the root family over its widest descendant branch span', () => {
    const result = placeRootDomains(preparedAsymmetricRootLayout())
    const domain = result.rootDomains[0]
    const rootUnit = result.units.find(unit => unit.isRootFamily)!

    expect(centerX(rootUnit.rect)).toBe(centerX(domain.rect))
  })

  it('keeps a bridge family outside both source root intervals', () => {
    const result = placeRootDomains(preparedTwoRootLayout())
    const bridge = result.units.find(unit => unit.rootSignature.length === 2)!

    expect(result.bridgeDomains.some(domain => domain.id === bridge.domainId)).toBe(true)
    expect(result.rootDomains.some(domain => rectContains(domain.rect, bridge.rect))).toBe(false)
  })
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/placeRootDomains.test.ts
```

Expected: FAIL，提示模块不存在。

- [x] **Step 3: 实现域内分支跨度计算**

先对每个 root domain 独立计算逻辑宽度：

1. unit 宽度使用 `familyUnitWidth` 并按 24px grid 向上取整。
2. 从最低 generation 向上，父家庭的 branch span 是直接子家庭 span 总和加 `familyGap`；没有子代时等于自身宽度。
3. 同一家庭的多个子女卡片若进入同一个子代家庭 unit，只计一次。
4. pedigree collapse 通过 visited `(rootId, unitId)` 防止重复计宽。
5. 每一代的打包宽度和根分支 span 取最大值作为 domain content width。
6. domain 左右各保留一个 `gridSize` 内边距；根家庭中心对齐 content center。

不得用卡片绝对位置反推 root 归属。

- [x] **Step 4: 分配连续域区间**

按 Task 6 的 domain sequence 扫描分配列：

```ts
function allocateDomainIntervals(
  domains: LayoutDomain[],
  contentWidthByDomainId: ReadonlyMap<string, number>,
  metrics: LayoutMetrics,
): AllocatedDomain[] {
  let x = 0
  return domains.map((domain, index) => {
    const previous = domains[index - 1]
    if (previous) {
      x += previous.kind === 'root' && domain.kind === 'root'
        ? metrics.rootGap
        : metrics.bridgeGap
    }
    const width = snapUp(contentWidthByDomainId.get(domain.id)!, metrics.gridSize)
    const allocated = { ...domain, x, width }
    x += width
    return allocated
  })
}
```

bridge band 位于两个 root interval 之间；bridge island 使用自己的连续 interval。任何 domain 都不与另一 domain 的正面积重叠。

- [x] **Step 5: 实现域内 generation 排序与坐标**

- 普通 root domain 行应用匹配 `domainId + generation` 的 `rowOrders`。
- bridge domain 行应用 `bridgeOrders`。
- 没有偏好时，以父/子 barycenter、同胞 block、unit ID 做稳定顺序；最多四次上下扫。
- 所有交换限于同一 domain，不允许跨域插入。
- y 坐标继续由 generation 和 `generationGap` 决定。
- x 坐标从 branch-first 初值开始，在域内做四次父子居中；每次移动后向左右扫描消除 overlap，并 clamp 回 domain rect。
- `previousScene` 仅用于 unchanged domain 的 tie-break 和整体平移选择，不能违反新域区间。

- [x] **Step 6: 物化场景几何**

使用 Task 1 的 `RootSceneGeometry`，并在 `materializeSceneGeometry.ts` 增加独立入口，旧入口保留到 Task 9：

```ts
export function materializeRootSceneGeometry(
  input: MaterializeRootSceneGeometryInput,
): RootSceneGeometry
```

`materializeRootSceneGeometry` 接收 rooted placed units 和 placed domains，并复用现有卡片/hub 物化私有函数。它保证：

- card 顺序严格跟随已经按来源根方向排序的 `unit.memberIds`；
- 每个 card 的 rect 完整位于所属 unit；
- 每个 unit 完整位于所属 domain；
- `bounds` 覆盖所有 domains、units 和 cards；
- 空场景返回 units/cards/hubs/rows/rootDomains/bridgeDomains 六个空数组和零 bounds。

- [x] **Step 7: 增加边缘布局测试**

覆盖：单根宽树、深窄树、同根表亲婚姻、两根多对互婚、多根 island、断开 component、只有单人、两边记录深度不相等、同代三个家庭各自有多子女。对每个场景断言：

```ts
expectNoCardOverlap(scene)
expectNoUnitOverlap(scene)
expectEveryUnitInsideExactlyOneDomain(scene)
expectRootDomainsDoNotInterleave(scene)
```

- [x] **Step 8: 验证 GREEN**

```bash
npm test -- src/core/family-layout/placeRootDomains.test.ts src/core/family-layout/materializeSceneGeometry.test.ts
npm run typecheck
```

Expected: PASS。

- [x] **Step 9: 提交根域网格排版**

```bash
git add src/core/family-layout/placeRootDomains.ts src/core/family-layout/placeRootDomains.test.ts src/core/family-layout/materializeSceneGeometry.ts src/core/family-layout/materializeSceneGeometry.test.ts src/core/family-layout/types.ts src/core/family-layout/rootLayoutTestHelpers.ts
git commit -m "feat: place continuous root lineage domains"
```

---

### Task 8: Route Family-Owned Lanes Through Domain Gateways

**Files:**
- Modify: `src/core/family-layout/types.ts`
- Modify: `src/core/family-layout/routeFamilyLanes.ts`
- Modify: `src/core/family-layout/routeFamilyLanes.test.ts`
- Modify: `src/core/family-layout/validateScene.ts`
- Modify: `src/core/family-layout/validateScene.test.ts`

- [x] **Step 1: 写域 gateway 和不同 owner 不重线失败测试**

在 router 测试增加两组同代相邻家庭、各自连接下代的场景，以及跨根家庭场景：

```ts
it('never shares a positive-length segment between neighboring families', () => {
  const result = routeFamilyLanes(neighborFamiliesRoutingInput())

  expect(result.diagnostics).toEqual([])
  expectDifferentOwnersShareNoPositiveSegment(result.routes)
})

it('routes a cross-domain parentage through deterministic gateways', () => {
  const input = crossRootGatewayRoutingInput()
  const result = routeFamilyLanes(input)
  const route = result.routes.find(value => value.routeOwnerId === 'parentage:a+b')!

  expect(route.gatewayIds).toEqual([
    'gateway:domain:root:a:right:parentage:a+b',
    'gateway:domain:bridge:a+b:left:parentage:a+b',
  ])
  expectRouteStartsAtHubAndEndsAtChildPorts(route, input.geometry)
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/routeFamilyLanes.test.ts src/core/family-layout/validateScene.test.ts
```

Expected: FAIL，route 没有 gateway 元数据，且邻近家庭 fixture 暴露重叠/不可路由。

- [x] **Step 3: 增加固定端口和 gateway 类型**

```ts
export interface RouteGateway {
  id: string
  domainId: string
  side: 'left' | 'right' | 'top' | 'bottom'
  point: Point
  routeOwnerId: string
}

export interface RoutedFamilyEdge {
  gatewayIds?: string[]
}
```

上面的片段表示给现有 `RoutedFamilyEdge` 增加 `gatewayIds`，不重定义原有字段。`RouteFamilyLanesResult` 增加 `gateways: RouteGateway[]`，由 router 产生并在 Task 9 并入公开 scene。端口固定：夫妻 hub、单亲底部独立 subport、子女卡片顶部中心；不能为了寻路改变连接对象。

为保持 Task 8 中间提交可编译，`RouteFamilyLanesInput` 暂时接受 `SceneGeometry | RootSceneGeometry`：旧几何沿用当前同域路由且返回空 gateways，新几何启用 domain gateway。所有新 primary routes 都显式写 `gatewayIds`（同域可为空数组）；辅助 route 可省略该字段。Task 9 切换后收窄生产调用为 `RootSceneGeometry`。

- [x] **Step 4: 分配 route-owner 独占车道**

保留当前按 group 范围从宽到窄排序，但 occupancy key 必须包含 orientation 和 subgrid coordinate。候选线段接受条件：

- 与相同 owner 可共线并 coalesce；
- 与不同 owner 正长度重叠或端点落在对方线段内部时拒绝；
- 垂直/水平内部点交叉允许，稍后在上层路线增加 bridge segment；
- 卡片、非端点家庭 unit 和域边界保留区是硬障碍；
- 同域 route 优先在两代之间的 lane channel 内完成；
- 跨域 route 必须按 source domain → source gateway → bridge corridor → target gateway → target port 的顺序。

gateway 坐标按 `routeOwnerId` 在同一域边界的字典序占用 8px subgrid 槽，不得两个 owner 使用相同点；gateway 是路由元数据，不渲染可见节点。

- [x] **Step 5: 明确同家庭允许共享的结构**

`buildRoute` 仍为一个 `ParentageGroup.id` 生成单一 route tree：

1. source hub 到 owner 独占 stem；
2. stem 到 child bus；
3. child bus 到多个 child top port。

只在同一 `RoutedFamilyEdge` 内 coalesce。这正是“同一个父辈出来的线可以一起”；任何跨 `routeOwnerId` coalesce 都是 bug。

- [x] **Step 6: 扩展 validator**

新增校验：

- 每条 primary route 连通且叶子恰好是一个 source hub 和一个以上 child top port；
- 不同 owner 无正长度共线、无假 T；
- 每个垂直/水平内部交叉至少一方在交叉点拥有 `bridge` segment；
- route 不穿过无关 card/unit；
- gateway 落在对应 domain 边界且 owner 匹配；
- unit/card 只被一个 domain 包含，root domain 的 x 区间不交错。

已有 `CROSS_FAMILY_SEGMENT_OVERLAP` 继续表达共线和假 T；gateway 或 domain 错误使用 `ROOT_DOMAIN_INTRUSION`；断线/错端点继续使用 `UNROUTABLE_PRIMARY_EDGE`。

- [x] **Step 7: 验证复杂路由**

运行：

```bash
npm test -- src/core/family-layout/routeFamilyLanes.test.ts src/core/family-layout/validateScene.test.ts
npm run typecheck
```

Expected: PASS；fixture 中至少包含允许点交叉但需要 bridge 的两条不同颜色路线，以及同代三个家庭不能共享 child bus 的回归用例。

- [x] **Step 8: 提交域感知路由**

```bash
git add src/core/family-layout/types.ts src/core/family-layout/routeFamilyLanes.ts src/core/family-layout/routeFamilyLanes.test.ts src/core/family-layout/validateScene.ts src/core/family-layout/validateScene.test.ts
git commit -m "feat: route families through root domain gateways"
```

---

### Task 9: Integrate The Root Pipeline And Safe Fallback

**Files:**
- Modify: `src/core/family-layout/layoutFamilyScene.ts`
- Modify: `src/core/family-layout/layoutFamilyScene.test.ts`
- Modify: `src/core/family-layout/buildSafeFallbackScene.ts`
- Modify: `src/core/family-layout/buildSafeFallbackScene.test.ts`
- Modify: `src/core/treeLayout.ts`
- Modify: `src/core/treeLayout.test.ts`
- Modify: `src/__tests__/fixtures/families.ts`
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

- [x] **Step 1: 写公开流水线失败测试**

先在 `src/__tests__/fixtures/families.ts` 导出 `twoRootMarriageFamilyData()` 和 `twoDisconnectedRootComponents()`；两者复用现有 fixture member/link helpers，并使用固定 ID。`expectedRootDomainIds()` 作为 `treeLayout.test.ts` 内的固定数组 helper。

```ts
it('returns continuous root and bridge domains through the public facade', async () => {
  const data = twoRootMarriageFamilyData()
  const scene = await layoutFamilyTree(Object.values(data.members), { data })

  expect(scene.rootDomains).toHaveLength(2)
  expect(scene.bridgeDomains).toHaveLength(1)
  expectRootDomainsDoNotInterleave(scene)
  expectNoCardOverlap(scene)
  expectDifferentOwnersShareNoPositiveSegment(scene.routes)
})

it('does not let rootMemberId redefine visible roots', async () => {
  const data = twoDisconnectedRootComponents()
  data.rootMemberId = 'component-b-descendant'
  const scene = await layoutFamilyTree(Object.values(data.members), { data })

  expect(scene.rootDomains.map(domain => domain.id).sort()).toEqual(expectedRootDomainIds())
  expect(scene.rootDomains[0].componentId).toBe('component:b')
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/layoutFamilyScene.test.ts src/core/treeLayout.test.ts
```

Expected: FAIL，公开流水线仍调用旧 cluster/order/compact。

- [x] **Step 3: 用新流水线替换编排**

`layoutFamilyScene` 固定顺序改为：

```ts
const projected = projectView(request.facts, request.view)
const built = buildFamilyUnits(projected, request.preferences, request.metrics)
const generations = assignGenerations(projected, built)
const baseUnits = attachGenerations(built.units, generations)
const discovery = discoverRootFamilies({
  projected,
  units: baseUnits,
  parentageGroups: built.parentageGroups,
  generationByUnitId: generations.generationByUnitId,
})
const signatures = propagateRootSignatures({
  projected,
  units: baseUnits,
  parentageGroups: built.parentageGroups,
  generationByUnitId: generations.generationByUnitId,
  roots: discovery,
})
const accents = assignRootAccents({
  roots: discovery.roots,
  signatures,
  preferences: request.preferences,
  previousScene: request.previousScene,
})
const domains = buildRootDomains({
  projected,
  units: baseUnits,
  signatures,
  accents,
  preferences: request.preferences,
  previousScene: request.previousScene,
  preferredComponentPersonId: request.preferredComponentPersonId,
})
const units = decorateRootedUnits({ baseUnits, signatures, domains, accents })
const geometry = placeRootDomains({
  units,
  parentageGroups: built.parentageGroups,
  domains: domains.domains,
  preferences: request.preferences,
  metrics: request.metrics,
  previousScene: request.previousScene,
  changedIds: request.changedIds,
})
```

然后路由、辅助层、校验和一次扩展 generation gap 重试继续沿用现有机制。此时让 `layoutFamilyScene` 和 `layoutFamilyTree` 返回 `RootLayoutScene`，并让 `treeLayout.ts` 对外将该类型导出为 `LayoutScene`；旧 core `LayoutScene` 只供尚待删除的 order/compact 测试使用。把 Task 6 新增的两个域诊断加入 unsafe set。`RouteFamilyLanesResult.gateways` 与 routes 一起并入 scene，validator 接受旧/新 scene 联合类型并只在 rooted scene 上校验 domain/gateway。旧 `materializeSceneGeometry` 若已无生产导入则保留到 Task 14，避免旧单元测试失效。

`FamilyCanvas.vue` 改为导入 `RootLayoutScene` 并用于 `EMPTY_SCENE`/scene ref；测试中的三个基础 scene 一次性补齐 rooted unit 字段、空/真实 domains 和 gateways。这里只做类型与新 scene 数据适配，视觉和拖拽仍留给 Task 10–11。

- [x] **Step 4: 更新 unsafe fallback**

fallback 继续保证每个人恰好一次和卡片不重叠，并保留：

- 根/桥接 domain ID、kind、signature、accent；
- unit 的 `domainId`、`memberRootIds` 和 `isRootFamily`；
- 空 routes 和明确原始 unsafe diagnostics；
- domain rect 根据 fallback unit rect 重算，不能返回错误包含关系。

fallback 不尝试伪造主关系线，因为断线比穿卡、重线和错接更可诊断。

- [x] **Step 5: 传递 rootMemberId 提示**

`LayoutRequest` 增加：

```ts
preferredComponentPersonId?: string
```

`treeLayout.ts` 将 `data.rootMemberId` 只映射到该字段；`viewpointId` 不进入 core layout request。更新测试证明两者都不改变 root signature/domain 归属。

- [x] **Step 6: 验证 Gate B 核心流水线**

```bash
npm test -- src/core/family-layout/layoutFamilyScene.test.ts src/core/treeLayout.test.ts src/__tests__/e2e/scenarios/layout-verification.test.ts
npm test
npm run typecheck
npm run build
npm run test:layout-perf
```

Expected:

- 全部测试和构建 PASS；
- 500 人性能脚本在仓库既有预算内 PASS；
- 没有 `NODE_OVERLAP`、`ROOT_DOMAIN_INTRUSION`、`CROSS_FAMILY_SEGMENT_OVERLAP` 或 `UNROUTABLE_PRIMARY_EDGE`；
- 同一 person 只出现一次。

- [x] **Step 7: 提交公开流水线切换**

```bash
git add src/core/family-layout/layoutFamilyScene.ts src/core/family-layout/layoutFamilyScene.test.ts src/core/family-layout/buildSafeFallbackScene.ts src/core/family-layout/buildSafeFallbackScene.test.ts src/core/treeLayout.ts src/core/treeLayout.test.ts src/core/family-layout/types.ts src/__tests__/fixtures/families.ts src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: switch to root lineage grid layout"
```

---
### Task 10: Render Implicit Root Identity And Cross-Root Couples

**Files:**
- Modify: `src/components/tree/MemberNode.vue`
- Modify: `src/components/tree/FamilyUnit.vue`
- Modify: `src/components/tree/RelationLayer.vue`
- Create: `src/__tests__/components/FamilyUnit.test.ts`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

- [x] **Step 1: 写根视觉失败测试**

创建 `FamilyUnit.test.ts`，断言 DOM 语义而不是浏览器实现的 `color-mix` 结果：

```ts
it('emphasizes a root family without a title or domain background', () => {
  const wrapper = mountFamilyUnit(rootFamilyUnit())

  expect(wrapper.attributes('data-root-family')).toBe('true')
  expect(wrapper.find('[data-testid="root-accent-rail"]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('根')
  expect(wrapper.find('[data-testid="root-domain-background"]').exists()).toBe(false)
})

it('renders a cross-root spouse axis with both source accents', () => {
  const wrapper = mountFamilyUnit(crossRootFamilyUnit())
  const axis = wrapper.find('[data-testid="spouse-axis"]')

  expect(axis.attributes('data-root-accents')).toBe('#4F7CAC,#B56576')
  expect(wrapper.findAll('[data-testid="member-root-rail"]')
    .map(node => node.attributes('data-root-accent')))
    .toEqual(['#4F7CAC', '#B56576'])
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/__tests__/components/FamilyUnit.test.ts src/__tests__/components/FamilyCanvas.test.ts
```

Expected: FAIL，新 data attributes 和根视觉不存在。

- [x] **Step 3: 实现成员根色侧边轨**

`MemberNode` 增加 props：

```ts
rootAccent?: string
showRootRail?: boolean
```

在卡片左侧内部渲染 4px rail，颜色来自该人物的唯一来源根；无唯一来源时使用 family `rootAccent`。轨道不能改变 card 宽度、port 坐标或点击/拖拽 hitbox。

- [x] **Step 4: 实现根家庭强调**

`FamilyUnit` 根据 `unit.isRootFamily` 渲染：

- 6px 根色左 rail；
- 比普通家庭高一级的 border opacity；
- 稍强但仍柔和的 shadow；
- 现有 soft family card background 可以保留；
- 不增加根域大背景、标题、徽标或文字。

所有视觉层 `pointer-events: none`，不能干扰卡片拖拽。

- [x] **Step 5: 实现跨根夫妻轴**

- 同根夫妻轴使用单一根色实线。
- 两根夫妻轴使用按当前卡片空间顺序的两段色/线性渐变，中点仍是 union hub。
- 多根签名家庭以 domain signature 顺序分段，最多显示四段；超过四根时使用前三根加 family accent 的末段，但 route 元数据仍保留完整签名。
- 当前配偶轴持续加粗，历史配偶仍只在辅助层使用虚线，不能覆盖当前轴。

- [x] **Step 6: RelationLayer 保持 owner 分组和 line bridge**

每个 `RoutedFamilyEdge` 继续独立 `<g data-route-owner>`；bridge segment 使用与所属 route 相同颜色并带背景擦除描边，形成可见跨线拱桥。不同 owner 即使颜色相近也不能合并成一个 SVG path。

- [x] **Step 7: 验证 GREEN**

```bash
npm test -- src/__tests__/components/FamilyUnit.test.ts src/__tests__/components/FamilyCanvas.test.ts
npm run typecheck
npm run build
```

Expected: PASS；DOM 中不存在 root domain background/title。

- [x] **Step 8: 提交根族视觉**

```bash
git add src/components/tree/MemberNode.vue src/components/tree/FamilyUnit.vue src/components/tree/RelationLayer.vue src/__tests__/components/FamilyUnit.test.ts src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: render implicit root lineage identity"
```

---

### Task 11: Constrain Family, Bridge, And Root-Domain Dragging

**Files:**
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`
- Modify: `src/pages/TreeView.vue`
- Modify: `src/__tests__/pages/TreeView.test.ts`

- [x] **Step 1: 扩展拖拽状态类型并写失败测试**

拖拽状态使用判别联合：

```ts
type FamilyDragState =
  | { mode: 'root-domain'; unitId: string; domainId: string; dx: number; dy: number }
  | { mode: 'root-row'; unitId: string; domainId: string; rowId: string; dx: number; dy: number }
  | { mode: 'bridge-row'; unitId: string; domainId: string; rowId: string; dx: number; dy: number }
```

增加测试：

```ts
it('rejects a normal family drop into another root domain', async () => {
  const wrapper = mountCanvas(twoRootScene())
  await dragUnitToX(wrapper, 'unit:a-child', centerOfUnit(wrapper, 'unit:b-child'))

  expect(wrapper.emitted('domain-row-order-change')).toBeUndefined()
  expect(wrapper.find('[data-testid="invalid-domain-drop"]').exists()).toBe(true)
})

it('reorders only bridge units inside the same bridge domain and generation', async () => {
  const wrapper = mountCanvas(twoBridgeFamilyScene())
  await dragUnitBefore(wrapper, 'unit:cross-2', 'unit:cross-1')

  expect(wrapper.emitted('bridge-order-change')).toEqual([[
    expect.objectContaining({
      domainId: 'domain:bridge:a+b',
      generation: 2,
      unitIds: ['unit:cross-2', 'unit:cross-1'],
    }),
  ]])
})

it('moves every unit in a root domain when dragging its root family', async () => {
  const wrapper = mountCanvas(threeRootScene())
  const before = domainUnitPositions(wrapper, 'domain:root:a')
  await dragUnitAfter(wrapper, 'unit:root:a', 'unit:root:b')

  expect(wrapper.emitted('root-order-change')).toEqual([[
    'component:main', ['root:b', 'root:a', 'root:c'],
  ]])
  expect(domainUnitPositions(wrapper, 'domain:root:a'))
    .toEqual(before.map(point => expect.objectContaining({ y: point.y })))
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts src/__tests__/pages/TreeView.test.ts
```

Expected: FAIL，Canvas 只有全局同代 row drag。

- [x] **Step 3: 判定拖拽模式**

pointer drag 开始时只根据 scene 元数据决定模式：

- `unit.isRootFamily && domain.kind === 'root'` → `root-domain`；
- `domain.kind === 'root'` → `root-row`；
- `domain.kind !== 'root'` → `bridge-row`。

不得根据卡片性别、显示顺序、route 或 CSS class 推断。

- [x] **Step 4: 普通家庭和桥接家庭落点限制**

row insertion 候选先过滤 `domainId` 和 `generation`，再按 x center 算 insertion index。拖到其他域或代的 preview 显示 invalid，但不 emit。有效 preview 只漂移同一候选行的邻居；父子重心的重新计算交给布局引擎完成。

事件改为：

```ts
(event: 'domain-row-order-change', preference: RowOrderPreference): void
(event: 'bridge-order-change', preference: BridgeOrderPreference): void
(event: 'root-order-change', componentId: string, rootIds: string[]): void
```

- [x] **Step 5: 根域整体拖拽预览**

拖动 root family 时：

- 使用 domain rect center 与相邻 root domain center 确定插入位置；
- 当前 domain 内全部 unit 使用相同 `dx`，保持内部相对位置；
- 被跨过的 root/bridge domains 按整域宽度和 gap 漂移；
- bridge domain 不作为可独立 root 落点，但跟随其 interaction component 重新计算预览顺序；
- y 方向只跟手显示轻微视觉位移，不改变 generation；
- pointer cancel、失焦、reset version 或新 layout request 必须取消整个预览。

- [x] **Step 6: TreeView 绑定新 Store actions**

将旧 `row-order-change` 绑定替换为三个新事件；页面不解释偏好内容，只转发到 Store。更新 Canvas stub 与页面测试。

- [x] **Step 7: 覆盖异步竞态**

沿用当前 `dragToken` 和 layout request ID：

- 旧 drop 布局返回不能清掉新 drag；
- 新拖拽取消后恢复最新持久化 scene；
- bridge/root drop 后在新 scene 落地前保留 preview；
- reset 优先级高于所有 pending drop。

- [x] **Step 8: 验证 GREEN**

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts src/__tests__/pages/TreeView.test.ts
npm run typecheck
```

Expected: PASS。

- [x] **Step 9: 提交域约束拖拽**

```bash
git add src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts src/pages/TreeView.vue src/__tests__/pages/TreeView.test.ts
git commit -m "feat: constrain dragging to root layout domains"
```

---

### Task 12: Reset Every Manual Layout Preference And Restore Focus

**Files:**
- Modify: `src/stores/family.ts`
- Modify: `src/stores/family.test.ts`
- Modify: `src/pages/TreeView.vue`
- Modify: `src/__tests__/pages/TreeView.test.ts`
- Modify: `src/components/tree/FamilyCanvas.vue`
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`

- [x] **Step 1: 写页面全量重置失败测试**

```ts
it('clears root, row and bridge order preferences with one reset', async () => {
  const wrapper = mountTreeViewWithOrders({
    rootOrders: [{ componentId: 'component:main', rootIds: ['root:b', 'root:a'] }],
    rowOrders: [domainRowPreference()],
    bridgeOrders: [bridgeRowPreference()],
  })

  await wrapper.get('[data-testid="restore-default-layout"]').trigger('click')

  expect(familyStore.clearAllLayoutOrderPreferences).toHaveBeenCalledOnce()
  expect(wrapper.getComponent(FamilyCanvas).props('resetLayoutVersion')).toBe(1)
})
```

补充：只有 rootOrders、只有 bridgeOrders 时按钮也可用；只有颜色 assignment 时按钮不可用，因为恢复默认布局不清除稳定颜色。

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/stores/family.test.ts src/__tests__/pages/TreeView.test.ts src/__tests__/components/FamilyCanvas.test.ts
```

Expected: FAIL，页面仍只检查/清除 rowOrders。

- [x] **Step 3: 更新页面恢复逻辑**

```ts
const canRestoreDefaultLayout = computed(() => {
  const preferences = data.value.layoutPreferences
  return preferences.rootOrders.length > 0
    || preferences.rowOrders.length > 0
    || preferences.bridgeOrders.length > 0
})

function restoreDefaultLayout() {
  if (!canRestoreDefaultLayout.value) return
  family.clearAllLayoutOrderPreferences()
  resetLayoutVersion.value += 1
}
```

删除 `clearRowOrderPreferences` 兼容包装及其所有调用。

- [x] **Step 4: 保持现有完整视图重置语义**

Canvas 收到新的 reset version 时必须：

1. 取消 unit/root/bridge drag 和 pending drop；
2. 发起不带 `previousScene` 的最新默认布局请求；
3. 丢弃更早返回的异步场景；
4. 新场景落地后调用 `resetToDefaultView()` 恢复 100%；
5. 若 `viewpointId` 对应 card 存在，聚焦该 card center；
6. 否则聚焦 `scene.bounds` center；
7. 空场景保持默认 origin。

这一步复用已经实现的 reset/focus 管道，只扩展取消状态和全量偏好，不另写第二套 pan/zoom 算法。

- [x] **Step 5: 验证视角与竞态**

```bash
npm test -- src/stores/family.test.ts src/__tests__/pages/TreeView.test.ts src/__tests__/components/FamilyCanvas.test.ts
npm run typecheck
```

Expected: PASS；有效/失效 viewpoint、无 viewpoint、空树和 reset 期间旧请求返回均有测试。

- [x] **Step 6: 提交全量恢复默认**

```bash
git add src/stores/family.ts src/stores/family.test.ts src/pages/TreeView.vue src/__tests__/pages/TreeView.test.ts src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: reset all root layout preferences"
```

---

### Task 13: Preserve Incremental Stability And Isolate Auxiliary Relations

**Files:**
- Modify: `src/core/family-layout/discoverRootFamilies.ts`
- Modify: `src/core/family-layout/discoverRootFamilies.test.ts`
- Modify: `src/core/family-layout/assignRootAccents.ts`
- Modify: `src/core/family-layout/assignRootAccents.test.ts`
- Modify: `src/core/family-layout/placeRootDomains.ts`
- Modify: `src/core/family-layout/placeRootDomains.test.ts`
- Modify: `src/core/family-layout/layoutFamilyScene.test.ts`
- Modify: `src/core/family-layout/routeAuxiliaryEdges.test.ts`

- [x] **Step 1: 写动态祖先和局部变化失败测试**

```ts
it('moves a root upward while preserving the old lineage color and neighborhood', () => {
  const before = layoutFamilyScene(requestBeforeAddingAncestor())
  const after = layoutFamilyScene(requestAfterAddingAncestor({ previousScene: before }))
  const oldDomain = before.rootDomains.find(domain => domain.id === 'domain:root:a0+a1')!
  const newDomain = after.rootDomains.find(domain => domain.id === 'domain:root:new-a0+new-a1')!

  expect(newDomain.accent).toBe(oldDomain.accent)
  expect(Math.abs(centerX(newDomain.rect) - centerX(oldDomain.rect)))
    .toBeLessThanOrEqual(DEFAULT_LAYOUT_METRICS.gridSize * 2)
})

it('does not move an unchanged disconnected root component', () => {
  const before = layoutFamilyScene(disconnectedComponentsRequest())
  const after = layoutFamilyScene(changeOnlyComponentA({ previousScene: before }))

  expect(domainRectsForComponent(after, 'component:b'))
    .toEqual(domainRectsForComponent(before, 'component:b'))
})
```

- [x] **Step 2: 运行测试并确认 RED**

```bash
npm test -- src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/assignRootAccents.test.ts src/core/family-layout/placeRootDomains.test.ts src/core/family-layout/layoutFamilyScene.test.ts
```

Expected: FAIL，动态根迁移或不相关 component 稳定性尚未满足。

- [x] **Step 3: 实现旧根到新根匹配记录**

在 discovery/model 结果增加：

```ts
previousRootIdByRootId: Record<string, string>
```

匹配规则复用 Task 5 的 descendant overlap；一对一贪心按 score 降序、old/new root ID tie-break，禁止一个旧根被多个新根同时继承。匹配结果同时用于颜色、root order 和 domain anchor。

- [x] **Step 4: 实现 component 级增量锚定**

- `changedIds` 先映射到 unit、root signature 和 interaction component。
- 完全未受影响且 domain 构成未变的 component 保留上一场景 domain rect 与 unit rect。
- 受影响 component 重新内部排版，再选择最接近旧 component center 的合法 grid offset。
- 若宽度增长与相邻 component 冲突，只把冲突方向后续 component 整体推开；不能压缩 rootGap 或让域交错。
- root order preference 始终高于 previousScene 锚点。

- [x] **Step 5: 证明辅助关系不影响主布局**

对相同家庭事实分别打开/关闭历史配偶、secondary parentage 和 godparent：

```ts
expect(primaryGeometry(withAuxiliary)).toEqual(primaryGeometry(withoutAuxiliary))
expect(primaryRoutes(withAuxiliary)).toEqual(primaryRoutes(withoutAuxiliary))
expect(auxiliaryRoutes(withAuxiliary).length).toBeGreaterThan(0)
```

辅助 route 继续在主场景完成后单独计算，使用虚线和自己的 kind；不得写 root signature、domain、generation 或 primary route occupancy。

- [x] **Step 6: 验证 GREEN**

```bash
npm test -- src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/assignRootAccents.test.ts src/core/family-layout/placeRootDomains.test.ts src/core/family-layout/layoutFamilyScene.test.ts src/core/family-layout/routeAuxiliaryEdges.test.ts
npm run typecheck
```

Expected: PASS。

- [x] **Step 7: 提交增量稳定性**

```bash
git add src/core/family-layout/discoverRootFamilies.ts src/core/family-layout/discoverRootFamilies.test.ts src/core/family-layout/assignRootAccents.ts src/core/family-layout/assignRootAccents.test.ts src/core/family-layout/placeRootDomains.ts src/core/family-layout/placeRootDomains.test.ts src/core/family-layout/layoutFamilyScene.test.ts src/core/family-layout/routeAuxiliaryEdges.test.ts src/core/family-layout/types.ts
git commit -m "feat: preserve root layout stability"
```

---

### Task 14: End-To-End Edge Cases, Performance, Documentation, And Legacy Removal

**Files:**
- Modify: `src/__tests__/fixtures/families.ts`
- Modify: `src/__tests__/e2e/scenarios/layout-verification.test.ts`
- Modify: `src/__tests__/performance/layout-performance.test.ts`
- Modify: `src/core/treeLayout.test.ts`
- Modify: `README.md`
- Delete: `src/core/family-layout/clusterLineages.ts`
- Delete: `src/core/family-layout/clusterLineages.test.ts`
- Delete: `src/core/family-layout/orderUnits.ts`
- Delete: `src/core/family-layout/orderUnits.test.ts`
- Delete: `src/core/family-layout/compactGrid.ts`
- Delete: `src/core/family-layout/compactGrid.test.ts`

- [x] **Step 1: 增加完整验收矩阵**

fixture 使用固定 ID 并覆盖：

1. 单根三代，多个同代家庭和多子女；
2. 两个根的一对跨根夫妻；
3. 两个根的多对子代互为配偶；
4. 三根链式 `A-B-C`；
5. 三根环状 `A-B-C-A`；
6. 重叠签名 `{A,B} × {B,C}`；
7. 同根表亲婚姻；
8. 直接嫁入/娶入且无上游；
9. 双方都有展开上游；
10. 当前收养、secondary parentage、继亲、历史配偶和教父母；
11. pedigree collapse 和断开 component；
12. 左右祖先记录深度不一致；
13. 新增更老祖先导致根向上迁移；
14. 500 人、至少 8 根、同时包含 pair bridge 和 multi-root island。

- [x] **Step 2: 为每个 fixture 运行同一组硬断言**

```ts
function expectValidRootLayout(scene: LayoutScene, expectedPersonIds: string[]) {
  expect(scene.cards.map(card => card.id).sort()).toEqual([...expectedPersonIds].sort())
  expect(new Set(scene.cards.map(card => card.id)).size).toBe(expectedPersonIds.length)
  expectNoCardOverlap(scene)
  expectNoUnitOverlap(scene)
  expectEveryUnitInsideExactlyOneDomain(scene)
  expectRootDomainsDoNotInterleave(scene)
  expectDifferentOwnersShareNoPositiveSegment(scene.routes)
  expectNoFalseTJunction(scene.routes)
  expectEveryCrossingHasBridge(scene.routes)
  expectRoutesAvoidUnrelatedCards(scene)
  expect(scene.diagnostics.filter(isUnsafeLayoutDiagnostic)).toEqual([])
}
```

跨根 fixture 额外断言家庭位于 bridge domain；同根婚配 fixture 断言没有 bridge domain；直接 incoming spouse fixture 断言只有一个 root domain。

- [x] **Step 3: 加入确定性和 permutation 测试**

对所有小型 fixture，以至少三种 members/partnerships/parentages 输入顺序运行布局，删除运行时耗时字段后断言完整 `LayoutScene` 深度相等。对相同 request 连续调用两次也必须相等。

- [x] **Step 4: 运行 500 人性能验证**

```bash
npm run test:layout-perf
npm test -- src/__tests__/performance/layout-performance.test.ts
```

Expected: PASS 既有同步布局预算；测试输出必须包含 person、root domain、bridge domain、route count 和 p95 时间。若新算法超过既有预算，先 profile `signature propagation`、domain barycenter 和 route occupancy，不能直接放宽预算。

- [x] **Step 5: 删除旧布局模块**

先确认无生产或测试导入：

```bash
rg -n "clusterLineages|orderUnits|compactGrid" src
```

Expected: 只有待删除文件自身命中。然后使用补丁删除六个旧文件；不删除仍被新排版复用的 `materializeSceneGeometry`、router、auxiliary router、validator 或 fallback。

删除旧 order/compact 调用后，同时删除 legacy `LayoutScene` / `SceneGeometry` 类型和旧 `materializeSceneGeometry` 入口，将 `RootLayoutScene`、`RootSceneGeometry` 分别重命名为唯一公开的 `LayoutScene`、`SceneGeometry`。这是纯类型收敛；运行 `rg -n "RootLayoutScene|RootSceneGeometry|PlacedFamilyUnit" src` 并逐个更新导入，不能保留两个可混用的场景模型。

- [x] **Step 6: 更新 README**

README 说明：

- 默认布局以可见祖先家庭为根族，根族用留白和颜色隐式区分；
- 跨根婚姻进入 bridge band/island；
- 当前夫妻整体移动，三种拖拽各自范围；
- 恢复默认布局清除全部手动排序并重置/聚焦视图；
- 关系线按家庭 owner 独占线段，允许带 bridge 的点交叉；
- 辅助关系不参与根族和主布局；
- core pipeline 新模块顺序和性能目标。

不要写未实现的 Worker、自动折叠、手动改根或背景分区功能。

- [x] **Step 7: 运行最终验证**

```bash
npm test
npm run typecheck
npm run build
npm run test:layout-perf
git status --short
```

Expected:

- 全部命令 PASS；
- `git status --short` 只显示本 Task 预期文件；
- console 无 Vue warning、未处理 Promise rejection 或 layout unsafe diagnostic；
- 没有新增依赖。

- [x] **Step 8: 扫描占位符和失效旧 API**

```bash
rg -n "TODO|TBD|FIXME|placeholder|clearRowOrderPreferences|row-order-change|clusterLineages|orderUnits|compactGrid" src README.md
```

Expected: 无命中；若测试描述需要英文单词 `placeholder`，将搜索结果逐条确认仅为现有拖拽 DOM test ID，不是实现占位符。

- [x] **Step 9: 提交硬化和旧引擎清理**

```bash
git add src/__tests__/fixtures/families.ts src/__tests__/e2e/scenarios/layout-verification.test.ts src/__tests__/performance/layout-performance.test.ts src/core/treeLayout.test.ts README.md src/core/family-layout
git commit -m "test: harden root lineage grid layout"
```

---

## Final Acceptance Checklist

- [x] 同一根族跨代连续聚合，任一代都没有其他根族家庭插入其列域。
- [x] 根族之间只有留白和隐式颜色/根家庭强调，没有大背景、标题或根标签。
- [x] 当前夫妻作为一个单位排版和移动；跨根夫妻卡片按来源根空间方向排序。
- [x] pair bridge 和 dense island 能覆盖多个子代互婚、三根环和重叠签名。
- [x] 当前收养跟随收养根；历史/secondary/step/godparent 不改变根或主几何。
- [x] 卡片和家庭单位没有重叠，主关系线不穿过无关卡片。
- [x] 不同家庭 route owner 没有正长度共线或假 T；点交叉都有 line bridge。
- [x] 普通、桥接、根域拖拽分别只写入对应 V4 排序偏好。
- [x] 恢复默认布局清空三种排序，恢复默认缩放并聚焦 viewpoint 或场景中心。
- [x] 新增更老祖先后根能向上迁移，同时尽量继承旧颜色、顺序和位置。
- [x] `rootMemberId` 只影响断开 component 优先级，`viewpointId` 只影响焦点。
- [x] 500 人性能、全量测试、typecheck 和 build 通过。
- [x] 旧 cluster/order/compact 生产路径和兼容 action 已删除，无新增依赖。

## Rollback Boundaries

- Gate A 只新增模型和 schema V4；若根语义不可靠，可回滚到 Gate A 前，公开布局不受影响。
- Gate B 切换公开流水线；如出现严重几何回归，回滚 Task 9 即恢复旧 cluster/order/compact 路径，V4 偏好仍可保留为空。
- Gate C 每个 UI/交互任务独立提交；视觉、拖拽、重置可以分别回滚，不需要回滚根布局数据模型。
- 不做数据降级写回。若必须退回 schema V3，先备份用户文件，再提供显式导出转换；不得直接把 V4 文件用 V3 parser 覆盖保存。

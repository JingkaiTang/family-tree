# Restore Default Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加“恢复默认布局”入口，一次清除手动同代顺序、重新运行默认排版、恢复 100% 缩放，并聚焦视角人物或家族树中心。

**Architecture:** Family Store 只负责清除持久化的 `rowOrders`；TreeView 负责发出一次性重置序号并清理 UI 会话视图；FamilyCanvas 把该序号转换为不携带 `previousScene` 的最新布局请求，在场景落地后恢复 100% 缩放，再聚焦有效视角人物或场景中心；PanZoomWrapper 提供强制默认值接口。继续使用现有请求 ID 解决异步竞态，不修改布局算法。

**Tech Stack:** Vue 3、Pinia、TypeScript、Vitest、Vue Test Utils、`@panzoom/panzoom`。

---

## Scope Check

四处改动共同完成一个不可拆分的用户操作，不需要拆成独立项目。实现保持现有数据模型，不增加依赖、持久化字段或布局算法分支。

## File Structure

- Modify `src/stores/family.ts`: 增加只清除 `rowOrders` 的 Store action。
- Modify `src/stores/family.test.ts`: 验证保留其他布局和关系语义，以及空状态 no-op。
- Modify `src/components/tree/PanZoomWrapper.vue`: 增加强制默认画布视图接口。
- Modify `src/__tests__/components/PanZoomWrapper.test.ts`: 验证接口忽略挂载时的会话视图。
- Modify `src/components/tree/FamilyCanvas.vue`: 接收一次性重置序号、取消本地拖拽状态、发起全量布局并在最新场景后重置视图。
- Modify `src/__tests__/components/FamilyCanvas.test.ts`: 验证全量重算、视角抑制、拖拽取消和过期请求。
- Modify `src/pages/TreeView.vue`: 增加按钮、可用状态和重置动作。
- Modify `src/__tests__/pages/TreeView.test.ts`: 验证页面级完整状态流。

---

### Task 1: Family Store 清除手动同代顺序

**Files:**
- Modify: `src/stores/family.test.ts`
- Modify: `src/stores/family.ts`

- [ ] **Step 1: 写失败测试**

在 `src/stores/family.test.ts` 的 row-order 测试之后增加：

```ts
it('clears only row order preferences and does nothing when already clear', () => {
  const family = useFamilyStore()
  family.$patch(state => {
    state.data.members.child = mk('child')
    state.data.layoutPreferences = {
      rowOrders: [{
        id: 'row:0',
        unitIds: ['unit:person:b', 'unit:person:a'],
      }],
      familyAccentAssignments: {
        'unit:person:a': '#123456',
      },
    }
    state.data.childLayoutAssignments.child = {
      primaryParentId: 'parent',
    }
  })
  family.markClean()

  family.clearRowOrderPreferences()

  expect(family.data.layoutPreferences).toEqual({
    rowOrders: [],
    familyAccentAssignments: {
      'unit:person:a': '#123456',
    },
  })
  expect(family.data.childLayoutAssignments.child).toEqual({
    primaryParentId: 'parent',
  })
  expect(family.isDirty).toBe(true)

  family.markClean()
  family.clearRowOrderPreferences()
  expect(family.isDirty).toBe(false)
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npm test -- src/stores/family.test.ts
```

Expected: FAIL，错误指出 `clearRowOrderPreferences` 不存在。

- [ ] **Step 3: 写最小实现**

在 `setRowOrderPreference` 后增加：

```ts
function clearRowOrderPreferences() {
  if (data.value.layoutPreferences.rowOrders.length === 0) return
  data.value.layoutPreferences.rowOrders = []
  markDirty()
}
```

并把 `clearRowOrderPreferences` 加入 Store return actions，紧跟 `setRowOrderPreference`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
npm test -- src/stores/family.test.ts
```

Expected: PASS，且无警告或错误输出。

- [ ] **Step 5: 提交 Store 改动**

```bash
git add src/stores/family.ts src/stores/family.test.ts
git commit -m "feat: clear manual row order preferences"
```

---

### Task 2: PanZoom 强制恢复产品默认视图

**Files:**
- Modify: `src/__tests__/components/PanZoomWrapper.test.ts`
- Modify: `src/components/tree/PanZoomWrapper.vue`

- [ ] **Step 1: 写失败测试**

在 `PanZoomWrapper` describe 中增加：

```ts
it('resets to the product default instead of the mounted session view', () => {
  const wrapper = mount(PanZoomWrapper, {
    props: {
      initialView: { x: 120, y: -80, scale: 1.75 },
    },
  })
  const instance = panzoom.mock.results.at(-1)!.value

  ;(wrapper.vm as unknown as { resetToDefaultView(): void }).resetToDefaultView()

  expect(instance.reset).toHaveBeenCalledWith({
    startScale: 1,
    startX: 0,
    startY: 0,
  })
  wrapper.unmount()
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npm test -- src/__tests__/components/PanZoomWrapper.test.ts
```

Expected: FAIL，错误指出 `resetToDefaultView` 不是函数。

- [ ] **Step 3: 写最小实现**

在现有 `resetView` 后增加：

```ts
function resetToDefaultView() {
  pz?.reset({
    startScale: 1,
    startX: 0,
    startY: 0,
  })
}
```

把 expose 改为：

```ts
defineExpose({
  resetView,
  resetToDefaultView,
  zoomIn,
  zoomOut,
  getScale,
  focusStagePoint,
  snapshot,
})
```

底部已有“重置”按钮继续调用 `resetView`，保持原交互不变。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
npm test -- src/__tests__/components/PanZoomWrapper.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 PanZoom 改动**

```bash
git add src/components/tree/PanZoomWrapper.vue src/__tests__/components/PanZoomWrapper.test.ts
git commit -m "feat: reset canvas to product defaults"
```

---

### Task 3: FamilyCanvas 协调全量重排与视图重置

**Files:**
- Modify: `src/__tests__/components/FamilyCanvas.test.ts`
- Modify: `src/components/tree/FamilyCanvas.vue`

- [ ] **Step 1: 扩展 PanZoom 测试替身**

在测试文件 hoisted mocks 中增加 `resetToDefaultView`：

```ts
const { focusStagePoint, getScale, layoutFamilyTree, resetToDefaultView } = vi.hoisted(() => ({
  focusStagePoint: vi.fn(),
  getScale: vi.fn(() => 1),
  layoutFamilyTree: vi.fn(),
  resetToDefaultView: vi.fn(),
}))
```

PanZoomStub expose 增加该方法：

```ts
expose({
  focusStagePoint,
  getScale,
  resetToDefaultView,
})
```

并在 `beforeEach` 中增加：

```ts
resetToDefaultView.mockReset()
```

- [ ] **Step 2: 写“最新重置请求”失败测试**

在视角聚焦测试之后增加：

```ts
it('recomputes without a previous scene and focuses the viewpoint after the reset scene', async () => {
  const data = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
  data.layoutPreferences.rowOrders = [{
    id: 'row:0',
    unitIds: ['unit:person:C', 'unit:person:A', 'unit:person:B'],
  }]
  layoutFamilyTree
    .mockResolvedValueOnce(structuredClone(sortableScene))
    .mockResolvedValueOnce(structuredClone(sortableScene))
  const wrapper = mountCanvas(data, {
    viewpointId: 'A',
    layoutResetVersion: 0,
  })
  await flushPromises()
  focusStagePoint.mockClear()

  const resetData = structuredClone(data)
  resetData.layoutPreferences.rowOrders = []
  await wrapper.setProps({
    data: resetData,
    layoutResetVersion: 1,
  })
  await flushPromises()

  expect(layoutFamilyTree).toHaveBeenCalledTimes(2)
  expect(layoutFamilyTree).toHaveBeenLastCalledWith(Object.values(resetData.members), {
    data: resetData,
    view: {
      showHistoricalPartnerships: false,
      showSecondaryParentage: false,
      showGodparentRelations: false,
    },
  })
  expect(resetToDefaultView).toHaveBeenCalledTimes(1)
  expect(focusStagePoint).toHaveBeenCalledWith(124, 148)
  expect(resetToDefaultView.mock.invocationCallOrder[0])
    .toBeLessThan(focusStagePoint.mock.invocationCallOrder[0])
})

it('focuses the family tree center after reset when no viewpoint is selected', async () => {
  const data = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
  layoutFamilyTree
    .mockResolvedValueOnce(structuredClone(sortableScene))
    .mockResolvedValueOnce(structuredClone(sortableScene))
  const wrapper = mountCanvas(data, { layoutResetVersion: 0 })
  await flushPromises()
  focusStagePoint.mockClear()

  await wrapper.setProps({
    data: structuredClone(data),
    layoutResetVersion: 1,
  })
  await flushPromises()

  expect(resetToDefaultView).toHaveBeenCalledTimes(1)
  expect(focusStagePoint).toHaveBeenCalledWith(364, 328)
})
```

- [ ] **Step 3: 写“取消拖拽与过期请求”失败测试**

增加两个测试：

```ts
it('cancels an active drag before recomputing the default layout', async () => {
  const resetLayout = deferred<LayoutScene>()
  layoutFamilyTree
    .mockResolvedValueOnce(structuredClone(sortableScene))
    .mockReturnValueOnce(resetLayout.promise)
  const data = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
  const wrapper = mountCanvas(data, { layoutResetVersion: 0 })
  await flushPromises()

  await beginDrag(wrapper, 2, -500, 0)
  expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(true)

  await wrapper.setProps({
    data: structuredClone(data),
    layoutResetVersion: 1,
  })
  await nextTick()

  expect(wrapper.find('[data-testid="family-unit-placeholder"]').exists()).toBe(false)
  resetLayout.resolve(structuredClone(sortableScene))
  await flushPromises()
  expect(resetToDefaultView).toHaveBeenCalledTimes(1)
})

it('does not reset the viewport from a reset request superseded by newer data', async () => {
  const staleReset = deferred<LayoutScene>()
  const accepted = deferred<LayoutScene>()
  layoutFamilyTree
    .mockResolvedValueOnce(structuredClone(sortableScene))
    .mockReturnValueOnce(staleReset.promise)
    .mockReturnValueOnce(accepted.promise)
  const data = familyData([mk('A'), mk('B'), mk('C'), mk('D')])
  const wrapper = mountCanvas(data, { layoutResetVersion: 0 })
  await flushPromises()

  await wrapper.setProps({
    data: structuredClone(data),
    layoutResetVersion: 1,
  })
  await nextTick()

  const newerData = structuredClone(data)
  newerData.members.X = mk('X')
  await wrapper.setProps({ data: newerData })
  await nextTick()

  accepted.resolve(structuredClone(sortableScene))
  await flushPromises()
  staleReset.resolve(structuredClone(sortableScene))
  await flushPromises()

  expect(resetToDefaultView).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: 运行测试并确认 RED**

Run:

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts
```

Expected: FAIL；重置序号目前不会触发布局，也不会按新场景聚焦视角人物或家族树中心。

- [ ] **Step 5: 增加重置属性和布局选项**

给 props 增加：

```ts
layoutResetVersion?: number
```

给 `updateLayout` options 增加：

```ts
resetViewport?: boolean
```

把布局提交后的聚焦逻辑改为：

```ts
if (options.resetViewport) {
  panzoomRef.value?.resetToDefaultView()
  if (!viewpointId || !focusMember(viewpointId)) {
    focusSceneCenter()
  }
} else if (
  viewpointId
  && !shouldSuppressFocus
  && !shouldSettleDrag
  && !options.preserveViewport
) {
  focusMember(viewpointId)
}
```

让人物聚焦返回是否成功，并增加场景中心回退：

```ts
function focusMember(id: string): boolean {
  const card = scene.value.cards.find(value => value.id === id)
  if (!card || !panzoomRef.value) return false
  panzoomRef.value.focusStagePoint(
    card.rect.x + card.rect.width / 2 + sceneOffset.value.x,
    card.rect.y + card.rect.height / 2 + sceneOffset.value.y,
  )
  return true
}

function focusSceneCenter() {
  if (!panzoomRef.value) return
  const bounds = scene.value.bounds
  if (scene.value.cards.length === 0) {
    panzoomRef.value.focusStagePoint(
      canvasSize.value.width / 2,
      canvasSize.value.height / 2,
    )
    return
  }
  panzoomRef.value.focusStagePoint(
    bounds.x + bounds.width / 2 + sceneOffset.value.x,
    bounds.y + bounds.height / 2 + sceneOffset.value.y,
  )
}
```

该代码必须保留在 `await nextTick()` 和第二次 `requestId` 校验之后。

- [ ] **Step 6: 合并数据与重置序号监听**

在 watcher 前记录初始序号：

```ts
let observedLayoutResetVersion = props.layoutResetVersion ?? 0
```

用以下 watcher 替换现有只监听 `props.data` 的 watcher：

```ts
watch(
  [() => props.data, () => props.layoutResetVersion ?? 0],
  ([, resetVersion]) => {
    if (resetVersion !== observedLayoutResetVersion) {
      observedLayoutResetVersion = resetVersion
      cancelPendingLayoutInteraction()
      void updateLayout({ resetViewport: true })
      return
    }
    if (expectedRowUpdate && hasExpectedRowOrder(props.data, expectedRowUpdate)) {
      expectedRowUpdate = null
      return
    }
    expectedRowUpdate = null
    void updateLayout()
  },
  { immediate: true, deep: true },
)
```

在拖拽状态函数附近增加：

```ts
function cancelPendingLayoutInteraction() {
  layoutRequestId += 1
  dragToken += 1
  dragState.value = null
  dragCanDrop.value = false
  expectedRowUpdate = null
  pendingDropToken = null
  pendingSceneRecovery = null
  auxiliaryRefreshQueued = false
  animatePositions.value = false
  if (settleTimer !== null) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
}
```

重置请求不传 `previousScene` 或 `changedIds`，因此得到当前事实和空 `rowOrders` 的算法默认结果。

- [ ] **Step 7: 运行测试并确认 GREEN**

Run:

```bash
npm test -- src/__tests__/components/FamilyCanvas.test.ts
```

Expected: PASS，现有拖拽、辅助关系和视角聚焦测试全部保持通过。

- [ ] **Step 8: 提交 Canvas 改动**

```bash
git add src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts
git commit -m "feat: coordinate default layout reset"
```

---

### Task 4: TreeView 增加恢复默认布局按钮

**Files:**
- Modify: `src/__tests__/pages/TreeView.test.ts`
- Modify: `src/pages/TreeView.vue`

- [ ] **Step 1: 扩展 FamilyCanvasStub**

把 stub props 改为：

```ts
props: ['selectedId', 'viewpointId', 'showAuxiliaryRelations', 'layoutResetVersion'],
```

- [ ] **Step 2: 写页面状态流失败测试**

在 `TreeView row order integration` describe 中增加：

```ts
it('restores the algorithm layout and the default canvas view without changing semantic state', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const family = useFamilyStore()
  const ui = useUiStore()
  family.$patch(state => {
    state.data.members = {
      child: mk('child'),
      parent: mk('parent'),
      viewpoint: mk('viewpoint'),
    }
    state.data.layoutPreferences = {
      rowOrders: [{
        id: 'row:0',
        unitIds: ['unit:person:viewpoint', 'unit:person:parent'],
      }],
      familyAccentAssignments: {
        'unit:person:parent': '#123456',
      },
    }
    state.data.childLayoutAssignments.child = {
      primaryParentId: 'parent',
    }
  })
  ui.setSelected('child')
  ui.setViewpoint('viewpoint')
  ui.setCanvasView({ x: 120, y: -80, scale: 1.75 })
  const wrapper = mount(TreeView, {
    global: {
      plugins: [pinia],
      stubs: {
        FamilyCanvas: FamilyCanvasStub,
        SearchBar: true,
      },
    },
  })

  const button = wrapper.get('[data-testid="restore-default-layout"]')
  expect(button.attributes('disabled')).toBeUndefined()
  await button.trigger('click')

  expect(family.data.layoutPreferences).toEqual({
    rowOrders: [],
    familyAccentAssignments: {
      'unit:person:parent': '#123456',
    },
  })
  expect(family.data.childLayoutAssignments.child).toEqual({
    primaryParentId: 'parent',
  })
  expect(ui.selectedId).toBe('child')
  expect(ui.viewpointId).toBe('viewpoint')
  expect(ui.canvasView).toBeNull()
  expect(wrapper.getComponent(FamilyCanvasStub).props('layoutResetVersion')).toBe(1)
  expect(button.attributes('disabled')).toBeDefined()
})
```

在已有 row-order integration 测试初始挂载后增加：

```ts
expect(wrapper.get('[data-testid="restore-default-layout"]')
  .attributes('disabled')).toBeDefined()
```

并在触发 `reorder-row` 后增加：

```ts
expect(wrapper.get('[data-testid="restore-default-layout"]')
  .attributes('disabled')).toBeUndefined()
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
npm test -- src/__tests__/pages/TreeView.test.ts
```

Expected: FAIL，找不到 `restore-default-layout` 按钮。

- [ ] **Step 4: 写最小页面实现**

把 Vue import 改为：

```ts
import { computed, onMounted, ref } from 'vue'
```

在 `rootId` 附近增加：

```ts
const layoutResetVersion = ref(0)
const canRestoreDefaultLayout = computed(() => (
  data.value.layoutPreferences.rowOrders.length > 0
))

function restoreDefaultLayout() {
  if (!canRestoreDefaultLayout.value) return
  family.clearRowOrderPreferences()
  ui.setCanvasView(null)
  layoutResetVersion.value += 1
}
```

在“清除视角”按钮附近增加：

```vue
<button
  data-testid="restore-default-layout"
  class="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
  :disabled="!canRestoreDefaultLayout"
  @click="restoreDefaultLayout"
>
  恢复默认布局
</button>
```

给 `FamilyCanvas` 增加：

```vue
:layout-reset-version="layoutResetVersion"
```

- [ ] **Step 5: 运行测试并确认 GREEN**

Run:

```bash
npm test -- src/__tests__/pages/TreeView.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交页面改动**

```bash
git add src/pages/TreeView.vue src/__tests__/pages/TreeView.test.ts
git commit -m "feat: add restore default layout action"
```

---

### Task 5: 完整回归验证

**Files:**
- Verify only; production code只在测试暴露真实缺陷时做最小修正。

- [ ] **Step 1: 运行相关测试集合**

```bash
npm test -- src/stores/family.test.ts src/__tests__/components/PanZoomWrapper.test.ts src/__tests__/components/FamilyCanvas.test.ts src/__tests__/pages/TreeView.test.ts
```

Expected: 全部 PASS，无未处理 promise、Vue warning 或控制台错误。

- [ ] **Step 2: 运行全量单元与集成测试**

```bash
npm test
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行类型检查与生产构建**

```bash
npm run build
```

Expected: `vue-tsc --noEmit` 与 Vite production build 均成功。

- [ ] **Step 4: 检查改动范围**

```bash
git diff --check
git status --short
```

Expected: 无空白错误；只有计划中列出的代码和测试文件发生变化。

- [ ] **Step 5: 如验证产生必要修正，单独提交**

仅当完整验证暴露真实缺陷时执行：

```bash
git add src/stores/family.ts src/stores/family.test.ts \
  src/components/tree/PanZoomWrapper.vue src/__tests__/components/PanZoomWrapper.test.ts \
  src/components/tree/FamilyCanvas.vue src/__tests__/components/FamilyCanvas.test.ts \
  src/pages/TreeView.vue src/__tests__/pages/TreeView.test.ts
git commit -m "fix: complete default layout reset verification"
```

不得顺手修改无关代码。

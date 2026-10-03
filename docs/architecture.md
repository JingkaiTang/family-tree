# 架构说明

本文描述 Family Tree 当前 alpha 架构、关键边界和贡献时必须保持的约束。

## 总体分层

```text
Vue pages/components
        │ 用户意图、展示、交互编排
        ▼
Pinia stores ───────────────► core/* 领域纯函数
        │                         ├─ kinship 称谓计算
        │                         └─ family-graph 共享家庭事实
        │                                   ├─ family-layout 家族网格 ─► Web Worker
        │ 修订号快照                       └─ focus-flow 聚焦纵流
        ▼
autosave / projectService
        │ schema + 图完整性校验
        ▼
projectRepository / projectTransfer
        │ 统一 ProjectRef + 最小 IPC 命令
        ▼
Rust commands
        │ 路径/大小/媒体 ID 校验、原子写入
        ▼
外部 .family 目录 / AppData 托管项目
```

## 前端职责

- `src/pages` 负责页面级流程，例如创建/打开项目、选择成员和路由。
- `src/stores` 是当前项目会话的单一状态源。每次受控变更递增 `revision`；切换项目递增 `projectToken`。
- `src/services/autosave.ts` 对不可变快照串行保存。只有保存结果仍匹配同一 `projectToken` 和 `revision` 时才清除脏状态；关闭窗口必须等待当前保存结束。
- `src/services/projectRepository.ts` 用 `ProjectRef` 统一桌面外部目录与移动端 AppData 托管项目；上层 Store 和媒体流程不持有裸路径。
- `src/services/projectTransfer.ts` 只通过受限 AppCache 暂存文件，在系统文档选择器与 Rust 备份命令之间传递 `.familybundle`。
- `src/services/projectService.ts` 是项目格式边界：打开时迁移并验证，保存前再次进行 Zod 和跨成员图校验。
- `src/core` 不依赖 Vue 或 Tauri，承载 schema、迁移、关系完整性、称谓与布局算法。

## 家族布局

`TreeLayoutHost.vue` 是两套布局的 UI 边界：原生桌面端默认使用家族网格，iOS/Android 默认使用聚焦纵流，浏览器环境使用触控设备启发式判断；用户可在“自动 / 聚焦纵流 / 家族网格”之间切换。选择保存在设备本地，不写入 `.family` 项目，也不会产生自动保存脏状态。网格的 pan/zoom 与纵流的聚焦点、展开分支和滚动位置分别保存，切换时互不转换。

两套布局只共享 `src/core/family-graph` 产出的规范化家庭事实。`selectedId`（选中成员）、`viewpointId`（称谓视角）和 `layoutFocusId`（纵流锚点）是三个独立状态。

### 家族网格

`src/core/treeLayout.ts` 是网格布局的异步门面。在浏览器中，它通过原生 Web Worker 调用 `treeLayoutCore.ts`；Worker 不可用或崩溃时退回同步纯函数，保证功能可用。每个请求由 ID 匹配，`FamilyCanvas` 还使用自己的请求序号丢弃过期结果。

核心流水线位于 `src/core/family-layout`：

```text
事实规范化 → 关系投影 → 家庭单元 → 代际 → 根发现/签名
→ 根域与桥域 → 网格几何 → 专属通道路由 → 场景校验/安全回退
```

流水线必须满足：

- 同一输入产生确定性结果；
- 不修改传入的 `FamilyData`；
- 布局偏好与亲属事实分离；
- 500 人性能测试通过；
- 无法安全布线时产生诊断并使用安全回退场景。

`FamilyCanvas.vue` 只保留布局生命周期、视口和事件编排。`familyCanvasModel.ts` 负责可单测的索引、命中判断和拖拽预览，`LayoutDiagnostics.vue` 负责诊断展示。

### 聚焦纵流

`src/core/focus-flow/layoutFocusFlow.ts` 是独立的同步纯函数引擎。它围绕聚焦成员投影父母家庭、当前家庭、兄弟姐妹家庭和子女家庭；更早祖辈、更晚后代、历史伴侣和干亲以分支摘要渐进展开。夫妻始终位于同一个家庭块，排序复用项目级 `siblingOrders`，其余回退到出生日期和成员 ID。

纵流场景使用普通文档流，由 `FocusFlowView.vue` 渲染，不依赖绝对坐标、网格偏好、pan/zoom 或网格 Worker。默认场景大小由聚焦邻域决定；宽分支只先展示四个家庭，用户显式展开后才物化其余块。

## 持久化与一致性

保存链路如下：

1. Store 变更产生新的修订号。
2. Autosave 捕获当前项目令牌、修订号和结构化克隆快照。
3. `projectService` 校验 schema 与关系图不变量。
4. Rust 命令确认目录是包含 `meta.json` 和 `family.json` 的真实项目根。
5. Rust 轮转三份 `family.json.bak.N`，再通过同目录临时文件和 rename 写入。
6. 成功结果仍属于当前修订时，Store 才标记为已保存。

浏览器页面隐藏或进入 `pagehide` 时会立即刷新同一个串行保存队列，以降低移动端 WebView 被系统冻结前的数据窗口。iOS/Android 的项目根固定在 AppData 的 `projects/<uuid>.family`；桌面端继续使用用户选择的外部目录。

照片先写入独立媒体文件并作为暂存 ID 传递。成员保存成功后该 ID 才成为项目引用；取消或组件卸载会回收未引用的暂存媒体。旧照片由显式删除或媒体 GC 移入 `.trash`。

项目格式详见 [project-format.md](project-format.md)。

## 本地文件安全边界

- Tauri capability 仅授予必要的窗口、对话框和 AppCache `transfers/` 文件操作；没有任意项目目录的 fs 插件权限，也没有 `assetProtocol: ["**"]`。
- 所有项目命令拒绝相对路径、`.`/`..` 路径片段、非目录和缺少项目标记的目录，并使用 canonical path。
- AppData 托管项目 ID 必须是 UUID；备份包限制压缩包大小、条目数、解压总量和单文件大小，拒绝路径穿越、符号链接、重复或未知条目。
- 照片 ID 只允许 ASCII 字母、数字、`_`、`-`；WebView 只接收照片字节并创建临时 Blob URL。
- CSP 限制脚本、图片和 IPC 来源；Blob 只用于应用生成的图片 URL。
- 本地项目当前不加密，应用也没有自动更新/签名发布链；这些属于发布阶段的独立安全工作。

## 测试层次

- 领域单元测试：schema、迁移、关系、称谓、共享家庭事实和两套布局阶段。
- 组件测试：Vue 交互、拖拽、视口和保存失败路径。
- Rust 单元测试：项目目录、版本、媒体导入/GC 和路径穿越。
- 性能门禁：确定性的 500 人家谱，CI p95 预算 1000ms。
- 构建门禁：TypeScript + Vite 生产构建、Cargo fmt/test/clippy、npm audit 和 RustSec audit。

CI 配置位于 `.github/workflows/ci.yml`。任何跨边界变更都应在对应层添加回归测试。

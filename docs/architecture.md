# 架构说明

本文描述 Family Tree 当前 alpha 架构、关键边界和贡献时必须保持的约束。Web/PWA 是唯一应用入口；桌面和手机复用同一套 Vue UI、领域逻辑和 IO 契约，通过浏览器直接读写用户授权的普通目录或 Google Drive。

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
services/storage / projectTransfer
        │ 按提供商路由 ProjectRef
        ▼
browser-directory       google-drive（每个 OAuth 应用/账号独立）
        │                         │
浏览器目录句柄           GIS 授权 + Drive REST
        │                         │
用户普通 .family 目录      用户 Drive 内追加版本与媒体
```

## 前端职责

- `src/pages` 负责页面级流程，例如创建/打开项目、选择成员和路由。
- `src/stores` 是当前项目会话的单一状态源。每次受控变更递增 `revision`；切换项目递增 `projectToken`。
- `src/services/autosave.ts` 对不可变快照串行保存。只有保存结果仍匹配同一 `projectToken` 和 `revision` 时才清除脏状态；应用内关闭项目等待保存，浏览器关闭页面仅能提示和尽力刷新，不能保证页面销毁后继续写入。
- `src/services/storage` 是项目和媒体 IO 入口，使用 `{ providerId, id, displayName }` 路由到存储提供商，当前实现为 `browser-directory` 和 Google Drive。上层不解释目录路径、浏览器句柄或云盘文件 ID；接口与扩展契约见 [storage.md](storage.md)。
- `src/services/projectTransfer.ts` 编排跨提供商备份导出与本地空目录导入。导出优先使用文件流，无保存选择器时返回有界 Blob 下载；完整归档要求所有引用照片可读。
- `src/services/googleDriveConnection.ts` 管理 Google 连接与按账号注册的提供商；令牌留在认证闭包，UI 只读取连接状态。`googleDriveClient.ts` 负责 GIS/REST，`googleDrive.ts` 负责项目、媒体和追加式版本协议。Drive 专属历史/冲突操作不侵入核心家谱 schema。
- `src/services/projectService.ts` 是项目格式边界：打开时迁移并验证，保存前再次进行 Zod 和跨成员图校验。
- `src/core` 不依赖 Vue 或具体存储实现，承载 schema、迁移、关系完整性、称谓与布局算法。
- `npm run build` 是唯一生产构建入口，输出 `dist/` 静态网页与 PWA 资源；不包含原生宿主、桥接层或平台工具链。
- PWA 的 Service Worker 仅缓存构建静态资源，不存储项目或媒体；新版本等待旧窗口自然关闭，不强制刷新编辑页面。

## 家族布局

`TreeLayoutHost.vue` 是两套布局的 UI 边界，直接复用原有组件：

| 运行形式 | 自动布局 | 共享实现 |
| --- | --- | --- |
| Web PC | 家族网格 | `FamilyCanvas.vue` |
| 移动 Web | 聚焦纵流 | `FocusFlowView.vue` |

浏览器在 UI store 创建时，依据移动设备 UA 或“粗指针且紧凑视口”检测一次默认布局。普通 PC 窗口变窄仍使用家族网格，手机横屏仍使用聚焦纵流。响应式工具栏和表单继续随视口调整，但欢迎页加载、窗口缩放和旋转不会覆盖已确定的浏览器布局。

用户可在“自动 / 聚焦纵流 / 家族网格”之间切换，显式选择优先于默认值。选择保存在设备本地，不写入 `.family` 项目，也不会产生自动保存脏状态。网格的 pan/zoom 与纵流的聚焦点、展开分支和滚动位置分别保存，切换时互不转换。

两套布局只共享 `src/core/family-graph` 产出的规范化家庭事实。`selectedId`（选中成员）、`viewpointId`（称谓视角）和 `layoutFocusId`（纵流锚点）是三个独立状态。

### 家族网格

`src/core/treeLayout.ts` 是网格布局的异步门面。在浏览器中，它通过浏览器 Web Worker 调用 `treeLayoutCore.ts`；Worker 不可用或崩溃时退回同步纯函数，保证功能可用。每个请求由 ID 匹配，`FamilyCanvas` 还使用自己的请求序号丢弃过期结果。

Worker 客户端在发送前对 JSON 领域数据与上一布局场景取独立快照，避免 Vue 响应式代理触发 structured clone 错误。核心层不依赖 Vue。生产浏览器测试直接检查 Worker 返回的布局结果，防止同步回退掩盖 Worker 失效。

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
2. Autosave 捕获完整项目引用、当前项目令牌、修订号和数据快照。
3. `projectService` 校验 schema 与关系图不变量。
4. 存储接口按完整项目引用选择提供商，适配器检查授权、项目标记和文件大小。
5. 浏览器目录保留三份 `family.json.bak.N`，成功关闭可写流后确认提交，写前比较磁盘内容。Drive 校验基准版本后追加完整快照，检查远端分支，上传确认成功后才完成保存。
6. 成功结果仍属于当前修订时，Store 才标记为已保存。

浏览器页面隐藏或进入 `pagehide` 时会立即刷新同一个串行保存队列，以降低系统冻结前的数据窗口；这不保证页面被杀死后完成写入。Web 目录句柄存于 IndexedDB，项目文件仍在用户目录。

浏览器同来源窗口使用 Web Locks 串行目录操作，但不同来源与外部编辑器不共享这把锁。磁盘内容比较也不是跨进程原子 CAS；应避免多个写入者同时编辑一个项目。统一 IO 不提供持续跨设备同步、多文件事务或自动冲突合并。Drive 采用独立不可变版本；双设备竞争产生分支时保留各次内容，要求用户选择并显式创建后续版本，不依赖未经保证的 Drive 条件覆盖。版本图检查也不能消除远端列表可见时序带来的延迟检测。

照片先写入独立媒体文件并作为暂存 ID 传递。成员保存成功后该 ID 才成为项目引用；取消或组件卸载会回收未引用的暂存媒体。本地目录先复制回收副本再删除原文件；Drive 为保留历史照片而不物理删除媒体。两者暂不提供 GC。浏览器只处理 PNG/JPEG/WebP，沿用主图和缩略图尺寸。

项目格式详见 [project-format.md](project-format.md)。

## 数据与授权安全边界

- 浏览器只有用户点击选择的目录句柄，后台 IO 不主动请求授权；不支持普通目录 API 时明确停止，不降级保存项目到 OPFS。新建/导入只接受空目录，归档条目和媒体标识必须通过校验。
- 项目引用使用不透明 ID 关联保存的浏览器目录句柄，不接收来自页面的任意绝对文件路径。打开和保存时校验项目标记与文件大小。
- 备份包限制压缩包大小、条目数、解压总量和单文件大小，拒绝路径穿越、符号链接、重复或未知条目。
- 照片 ID 只允许 ASCII 字母、数字、`_`、`-`；图片组件接收 Blob 并创建临时 URL，用后释放。
- 项目没有应用层加密。PWA 按静态资源更新流程发布；静态主机不存储用户项目，部署凭据不进入网页产物。
- Drive 仅申请 `drive.file`，连接身份绑定公开 Client ID 与账号 `permissionId`；令牌只保留在内存，重新授权核对账号。Drive 项目及照片直接上传至用户账号，不进入应用后端。
- PWA 不缓存云端数据、照片或令牌，也不维护离线上传队列。网络或授权失败时仍保留脏状态；JSON 草稿下载不包含照片，不等于完整备份。

## 测试层次

- 领域单元测试：schema、迁移、关系、称谓、共享家庭事实和两套布局阶段。
- 组件测试：Vue 交互、拖拽、视口和保存失败路径。
- 浏览器存储/归档测试：权限、备份、外部修改冲突、媒体处理、流大小限制与失败清理。
- Drive 测试：GIS/REST 替身下的授权、账号隔离、追加版本、跨设备冲突、失败重试及浏览器业务流程；真实 Google 授权和目标设备另行验收。
- Playwright：真实 Chromium 验证 Web 流程，使用 OPFS 句柄替代无法操作的系统选择器；生产不运行 OPFS，系统权限和 Android 文档提供程序需真机验收。
- 生产 PWA：真实构建与 Service Worker 验证根目录/子目录离线启动、懒加载、更新等待旧窗口关闭及失败更新保留旧缓存。
- 性能门禁：确定性的 500 人家谱，CI p95 预算 1000ms。
- 构建门禁：TypeScript + Vite 生产构建、npm audit。

CI 配置位于 `.github/workflows/ci.yml`，完整命令与失败排查见 [测试说明](testing.md)，依赖用途与兼容决策见 [依赖管理](dependencies.md)。任何跨边界变更都应在对应层添加回归测试。

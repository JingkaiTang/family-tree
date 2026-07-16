# 架构说明

本文描述 Family Tree 当前 alpha 架构、关键边界和贡献时必须保持的约束。

## 总体分层

```text
Vue pages/components
        │ 用户意图、展示、交互编排
        ▼
Pinia stores ───────────────► core/* 领域纯函数
        │                         │
        │ 修订号快照               ├─ kinship 称谓计算
        ▼                         └─ family-layout 确定性布局
autosave / projectService              │
        │ schema + 图完整性校验          ▼
        ▼                         Web Worker
tauriApi
        │ 最小 IPC 命令
        ▼
Rust commands
        │ 路径/大小/媒体 ID 校验、原子写入
        ▼
.family 项目目录
```

## 前端职责

- `src/pages` 负责页面级流程，例如创建/打开项目、选择成员和路由。
- `src/stores` 是当前项目会话的单一状态源。每次受控变更递增 `revision`；切换项目递增 `projectToken`。
- `src/services/autosave.ts` 对不可变快照串行保存。只有保存结果仍匹配同一 `projectToken` 和 `revision` 时才清除脏状态；关闭窗口必须等待当前保存结束。
- `src/services/projectService.ts` 是项目格式边界：打开时迁移并验证，保存前再次进行 Zod 和跨成员图校验。
- `src/core` 不依赖 Vue 或 Tauri，承载 schema、迁移、关系完整性、称谓与布局算法。

## 家族布局

`src/core/treeLayout.ts` 是异步门面。在浏览器中，它通过原生 Web Worker 调用 `treeLayoutCore.ts`；Worker 不可用或崩溃时退回同步纯函数，保证功能可用。每个请求由 ID 匹配，`FamilyCanvas` 还使用自己的请求序号丢弃过期结果。

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

## 持久化与一致性

保存链路如下：

1. Store 变更产生新的修订号。
2. Autosave 捕获当前项目令牌、修订号和结构化克隆快照。
3. `projectService` 校验 schema 与关系图不变量。
4. Rust 命令确认目录是包含 `meta.json` 和 `family.json` 的真实项目根。
5. Rust 轮转三份 `family.json.bak.N`，再通过同目录临时文件和 rename 写入。
6. 成功结果仍属于当前修订时，Store 才标记为已保存。

照片先写入独立媒体文件并作为暂存 ID 传递。成员保存成功后该 ID 才成为项目引用；取消或组件卸载会回收未引用的暂存媒体。旧照片由显式删除或媒体 GC 移入 `.trash`。

项目格式详见 [project-format.md](project-format.md)。

## 桌面安全边界

- Tauri capability 仅授予 core 默认只读信息、窗口销毁和目录选择。
- WebView 没有通用 fs 插件权限，也没有 `assetProtocol: ["**"]`。
- 所有项目命令拒绝相对路径、`.`/`..` 路径片段、非目录和缺少项目标记的目录，并使用 canonical path。
- 照片 ID 只允许 ASCII 字母、数字、`_`、`-`；WebView 只接收照片字节并创建临时 Blob URL。
- CSP 限制脚本、图片和 IPC 来源；Blob 只用于应用生成的图片 URL。
- 本地项目当前不加密，应用也没有自动更新/签名发布链；这些属于发布阶段的独立安全工作。

## 测试层次

- 领域单元测试：schema、迁移、关系、称谓和布局阶段。
- 组件测试：Vue 交互、拖拽、视口和保存失败路径。
- Rust 单元测试：项目目录、版本、媒体导入/GC 和路径穿越。
- 性能门禁：确定性的 500 人家谱，CI p95 预算 1000ms。
- 构建门禁：TypeScript + Vite 生产构建、Cargo fmt/test/clippy、npm audit 和 RustSec audit。

CI 配置位于 `.github/workflows/ci.yml`。任何跨边界变更都应在对应层添加回归测试。

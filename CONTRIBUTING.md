# 贡献指南

感谢你考虑参与 Family Tree。项目目前处于 alpha 阶段，优先接受能够提升数据可靠性、布局正确性、中文称谓覆盖和跨平台稳定性的改动。

## 开始之前

- Bug 和功能建议请先使用对应的 Issue 模板，说明最小复现、预期行为和实际行为。
- 安全问题不要创建公开 Issue，请按 [安全政策](SECURITY.md) 私下报告。
- 测试数据只能使用虚构人物；不要提交真实家谱、照片、住址或其他个人信息。
- 大型重构请先在 Issue 中对齐边界、兼容性和迁移方案。

## 本地开发

Web 开发推荐 Node.js 24 LTS（CI 使用 24），支持 22.12+（22.x）、24.x 或 26+；直接 `npm run dev` 即可使用普通目录存储。项目只维护 Web/PWA，不需要桌面或移动原生工具链。部署说明见 [Web/PWA](docs/web-deployment.md)，依赖用途与升级兼容例外见 [依赖管理](docs/dependencies.md)。

```bash
npm ci
npm test
npm run build
npm audit
npm run test:e2e
npm run test:pwa
npm run test:layout-perf
```

`npm run typecheck` 检查 Vue/应用代码、构建配置和浏览器测试，包含测试专用服务器。`npm run build` 先执行同一类型检查，再生成 `dist/` 静态网页。桌面浏览器和移动浏览器使用同一产物；开发与生产部署要求见 [Web/PWA 部署说明](docs/web-deployment.md)。

浏览器测试使用 Playwright：可通过 `npx playwright install chromium` 安装浏览器；配置会优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，否则尝试 `/usr/bin/chromium` 或 Playwright 自带版本。无头测试用真实 OPFS 句柄替代系统目录选择器，覆盖浏览器 IO 和句柄持久化；生产不使用 OPFS，系统授权和手机文档提供程序仍需真机验收。`test:e2e` 使用开发服务器，`test:pwa` 单独构建生产资源并覆盖真实 Service Worker。测试分层、失败产物和 CI 要求见 [测试说明](docs/testing.md)。

编辑器应遵守仓库根目录的 `.editorconfig`。前端目前没有全仓自动格式化命令，请延续现有 TypeScript/Vue 风格并避免格式化无关文件。

## 设计约束

- 亲属关系必须保持双向一致，不允许悬空引用、自引用、重复引用或祖先环。
- 项目格式变更必须递增 `SCHEMA_VERSION`、添加迁移和回归测试，并同步 `docs/project-format.md`。
- 布局核心必须保持确定性的纯函数；浏览器入口通过 Web Worker 调用，Node 测试保留同步入口。
- Vue 组件负责交互编排，领域计算应进入 `src/core` 或可单测的纯模型。
- 所有项目/媒体 IO 经过统一 `ProjectStorageProvider`，UI 和领域逻辑不解释具体路径或调用平台读写。本地提供商使用用户授权的普通目录，Drive 提供商绑定 OAuth 应用与账号；适配器必须校验项目标记、媒体标识和归档条目。
- 桌面和移动浏览器共享界面与领域代码；存储差异留在提供商适配器中。Web 不支持目录 API 时明确提示，不静默改存浏览器私有空间。
- Web PC 保留 `FamilyCanvas`，移动 Web 保留 `FocusFlowView`；自动布局在会话初始化时按设备判断，窗口大小变化只影响响应式样式，不重选布局。设备本地的显式布局偏好优先。
- 保存成功必须表示已完成当前提供商的持久化；多文件事务、跨来源/外部程序并发和云盘版本冲突不可用进程内修订号代替。
- 只修改当前任务需要的代码，不在同一 PR 中夹带无关格式化或重构。

更完整的边界说明见 [架构文档](docs/architecture.md)。

## 提交与 Pull Request

- 每个提交表达一个可验证的意图，提交信息建议使用 `type: summary`，例如 `fix: reject cyclic ancestry`。
- PR 描述应包含问题、方案、风险、验证结果和界面改动截图（如适用）。
- 新行为应有测试；修复缺陷时优先先加入能够复现问题的测试。
- 确认没有提交生成目录、密钥、真实家谱或无关二进制文件。
- 维护者可能要求拆分过大的 PR，或补充格式迁移、回滚路径和性能数据。

提交贡献即表示你同意按仓库的 [MIT License](LICENSE) 授权该贡献。

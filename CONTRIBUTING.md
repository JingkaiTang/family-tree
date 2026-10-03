# 贡献指南

感谢你考虑参与 Family Tree。项目目前处于 alpha 阶段，优先接受能够提升数据可靠性、布局正确性、中文称谓覆盖和跨平台稳定性的改动。

## 开始之前

- Bug 和功能建议请先使用对应的 Issue 模板，说明最小复现、预期行为和实际行为。
- 安全问题不要创建公开 Issue，请按 [安全政策](SECURITY.md) 私下报告。
- 测试数据只能使用虚构人物；不要提交真实家谱、照片、住址或其他个人信息。
- 大型重构请先在 Issue 中对齐边界、兼容性和迁移方案。

## 本地开发

Web 开发需要 Node.js 20.19+（20.x）或 22.12+；直接 `npm run dev` 即可使用普通目录存储。只有原生宿主开发和 Rust 验证需要 Rust stable 及当前平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)。部署说明见 [Web/PWA](docs/web-deployment.md)。

```bash
npm ci
npm test
npm run build
npm run test:e2e
npm run test:layout-perf
```

原生改动继续执行：

```bash
cd src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo audit
```

`cargo audit` 需要先安装 [cargo-audit](https://github.com/rustsec/rustsec/tree/main/cargo-audit)；CI 会通过 RustSec 官方 Action 执行同类检查。

`test:e2e` 使用 Playwright：可通过 `npx playwright install chromium` 安装浏览器；配置会优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，否则尝试 `/usr/bin/chromium` 或 Playwright 自带版本。无头测试用真实 OPFS 句柄替代系统目录选择器，覆盖浏览器 IO 和句柄持久化；生产不使用 OPFS，系统授权和手机文档提供程序仍需真机验收。生产 PWA 的离线启动与等待更新应使用构建产物另行验证，开发服务器 E2E 不覆盖 Service Worker。

### 平台构建提示

- Windows 请使用 MSVC Rust 工具链，并按 Tauri 文档安装 Visual Studio C++ 构建工具。若从 Git Bash 启动时命中了同名的 Unix `link`，请改用已初始化 Visual Studio 环境的 PowerShell 或 Developer Command Prompt。
- macOS 的 CI、沙箱或其他无 GUI 环境无法运行 DMG 的 Finder 美化脚本时，可使用 `CI=true npm run tauri:build`；安装包仍会生成，但不包含自定义 Finder 排版。
- iOS/Android 需要额外原生工具链；初始化、构建、AppData/备份语义和真机验收清单见 [移动端开发说明](docs/mobile-development.md)。

编辑器应遵守仓库根目录的 `.editorconfig`。前端目前没有全仓自动格式化命令，请延续现有 TypeScript/Vue 风格并避免格式化无关文件；Rust 代码以 `cargo fmt` 结果为准。

## 设计约束

- 亲属关系必须保持双向一致，不允许悬空引用、自引用、重复引用或祖先环。
- 项目格式变更必须递增 `SCHEMA_VERSION`、添加迁移和回归测试，并同步 `docs/project-format.md`。
- 布局核心必须保持确定性的纯函数；浏览器入口通过 Web Worker 调用，Node 测试保留同步入口。
- Vue 组件负责交互编排，领域计算应进入 `src/core` 或可单测的纯模型。
- 所有项目/媒体 IO 经过统一 `ProjectStorageProvider`，UI 和领域逻辑不解释具体路径或调用平台读写。浏览器仅使用用户授权的普通目录；原生文件系统访问只能经过受校验的 Tauri 命令，不重新开放宽泛的 fs 或 asset protocol 权限。
- 平台差异留在适配器与宿主交互中，桌面、Web/PWA 和移动端共享界面及领域代码。Web 不支持目录 API 时明确提示，不静默改存浏览器私有空间。
- 保存成功必须表示已完成当前提供商的持久化；多文件事务、跨来源/原生并发和未来云盘版本冲突不可用进程内修订号代替。
- 只修改当前任务需要的代码，不在同一 PR 中夹带无关格式化或重构。

更完整的边界说明见 [架构文档](docs/architecture.md)。

## 提交与 Pull Request

- 每个提交表达一个可验证的意图，提交信息建议使用 `type: summary`，例如 `fix: reject cyclic ancestry`。
- PR 描述应包含问题、方案、风险、验证结果和界面改动截图（如适用）。
- 新行为应有测试；修复缺陷时优先先加入能够复现问题的测试。
- 确认没有提交生成目录、密钥、真实家谱或无关二进制文件。
- 维护者可能要求拆分过大的 PR，或补充格式迁移、回滚路径和性能数据。

提交贡献即表示你同意按仓库的 [MIT License](LICENSE) 授权该贡献。

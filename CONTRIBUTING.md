# 贡献指南

感谢你考虑参与 Family Tree。项目目前处于 alpha 阶段，优先接受能够提升数据可靠性、布局正确性、中文称谓覆盖和跨平台稳定性的改动。

## 开始之前

- Bug 和功能建议请先使用对应的 Issue 模板，说明最小复现、预期行为和实际行为。
- 安全问题不要创建公开 Issue，请按 [安全政策](SECURITY.md) 私下报告。
- 测试数据只能使用虚构人物；不要提交真实家谱、照片、住址或其他个人信息。
- 大型重构请先在 Issue 中对齐边界、兼容性和迁移方案。

## 本地开发

需要 Node.js 20+、Rust stable，以及当前平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
npm test
npm run build
npm run test:layout-perf

cd src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo audit
```

`cargo audit` 需要先安装 [cargo-audit](https://github.com/rustsec/rustsec/tree/main/cargo-audit)；CI 会通过 RustSec 官方 Action 执行同类检查。

编辑器应遵守仓库根目录的 `.editorconfig`。前端目前没有全仓自动格式化命令，请延续现有 TypeScript/Vue 风格并避免格式化无关文件；Rust 代码以 `cargo fmt` 结果为准。

## 设计约束

- 亲属关系必须保持双向一致，不允许悬空引用、自引用、重复引用或祖先环。
- 项目格式变更必须递增 `SCHEMA_VERSION`、添加迁移和回归测试，并同步 `docs/project-format.md`。
- 布局核心必须保持确定性的纯函数；浏览器入口通过 Web Worker 调用，Node 测试保留同步入口。
- Vue 组件负责交互编排，领域计算应进入 `src/core` 或可单测的纯模型。
- 文件系统访问只能经过受校验的 Tauri 命令；不要重新开放宽泛的 fs 或 asset protocol 权限。
- 只修改当前任务需要的代码，不在同一 PR 中夹带无关格式化或重构。

更完整的边界说明见 [架构文档](docs/architecture.md)。

## 提交与 Pull Request

- 每个提交表达一个可验证的意图，提交信息建议使用 `type: summary`，例如 `fix: reject cyclic ancestry`。
- PR 描述应包含问题、方案、风险、验证结果和界面改动截图（如适用）。
- 新行为应有测试；修复缺陷时优先先加入能够复现问题的测试。
- 确认没有提交生成目录、密钥、真实家谱或无关二进制文件。
- 维护者可能要求拆分过大的 PR，或补充格式迁移、回滚路径和性能数据。

提交贡献即表示你同意按仓库的 [MIT License](LICENSE) 授权该贡献。

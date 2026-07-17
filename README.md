# 家族树 (Family Tree)

[![CI](https://github.com/JingkaiTang/family-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/JingkaiTang/family-tree/actions/workflows/ci.yml)

一款面向中文家庭关系的本地优先桌面应用，使用 Tauri 2、Vue 3 和 Rust 构建。

![家族树主界面，展示虚构的六代家族](docs/assets/family-tree-overview.jpg)

> 截图使用仓库内的虚构测试数据和合成头像，不包含真实个人信息。

> **项目状态：Alpha。** 当前仅建议从源码构建，尚未提供签名安装包、自动更新或稳定数据格式承诺。请定期备份真实项目；本地 `.family` 项目文件不加密。

[架构说明](docs/architecture.md) · [项目格式](docs/project-format.md) · [发布说明](docs/releasing.md) · [贡献指南](CONTRIBUTING.md) · [安全政策](SECURITY.md) · [更新记录](CHANGELOG.md)

## 功能

- **家族关系可视化**：按家庭单元和代际布局成员，支持缩放、平移、家庭拖拽与恢复默认布局。
- **复杂家庭结构**：支持当前及历史配偶、养育/继亲、次要父母和干亲等关系。
- **中文亲属称谓**：计算常见的直系、旁系与姻亲称谓，并支持按家庭习惯自定义覆盖。不同地区和家庭的称谓存在差异，自动结果仍需使用者确认。
- **成员资料管理**：记录姓名、性别、出生日期、照片、籍贯和职业等信息。
- **本地优先**：数据保存在使用者选择的普通文件夹中，应用不主动上传，便于自行复制和备份。
- **数据可靠性**：项目打开和保存时执行结构校验，自动保留有限数量的本地备份。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- Rust stable（推荐通过 [rustup](https://rustup.rs/) 安装）
- 当前平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

### 开发与构建

```bash
npm ci
npm run tauri:dev
```

仅调试前端界面时可运行 `npm run dev`；创建项目、打开本地文件和管理照片等能力需要 Tauri 桌面进程。

构建当前平台的安装包：

```bash
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/`。跨平台环境准备和常见构建问题见 [贡献指南](CONTRIBUTING.md)。

### 验证改动

```bash
npm test
npm run build
npm run test:layout-perf

cd src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
```

`test:layout-perf` 使用确定性的 500 人虚构家谱执行性能门禁，建议在资源稳定的本机或 CI 中运行。

## 技术概览

| 层 | 技术 |
|---|---|
| 桌面与本地文件 | Tauri 2、Rust |
| 前端 | Vue 3、TypeScript、Pinia、Tailwind CSS |
| 数据与校验 | JSON、Zod、版本迁移与本地备份 |
| 家族树 | 自研家庭单元布局与连线路由、Web Worker |
| 测试 | Vitest、Rust test/clippy、RustSec audit |

核心领域逻辑位于 `src/core`，Vue 组件负责交互编排；Tauri 后端只暴露受校验的本地文件命令。中文称谓采用“关系图寻路 → 路径规范化 → 规则翻译”的流水线，布局采用确定性的纯函数核心并通过 Web Worker 运行。完整边界和数据流见 [架构文档](docs/architecture.md)。

## 参与贡献

欢迎通过 Issue 和 Pull Request 参与。请先阅读 [贡献指南](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。

请勿提交真实家谱、照片、住址或其他个人信息；安全漏洞请按 [安全政策](SECURITY.md) 私下报告。

## 许可

本项目采用 [MIT License](LICENSE)。

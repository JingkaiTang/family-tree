# 家族树 (Family Tree)

[![CI](https://github.com/JingkaiTang/family-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/JingkaiTang/family-tree/actions/workflows/ci.yml)

一款面向中文家庭关系的本地优先应用。桌面与移动设备共用 Vue 网页界面和领域逻辑，通过 Web/PWA 使用用户授权的普通目录，或连接自己的 Google Drive。项目只分发网页，不再维护原生桌面或移动应用。

![家族树主界面，展示虚构的六代家族](docs/assets/family-tree-overview.jpg)

> 截图使用仓库内的虚构测试数据和合成头像，不包含真实个人信息。

> **项目状态：Alpha。** 支持纯静态部署，无需应用账号或业务后端。尚未承诺稳定数据格式。请定期导出 `.familybundle` 备份；项目和备份没有应用层加密。

[Web 部署与使用](docs/web-deployment.md) · [Google Drive 配置](docs/google-drive.md) · [存储接口](docs/storage.md) · [架构说明](docs/architecture.md) · [依赖管理](docs/dependencies.md) · [项目格式](docs/project-format.md) · [发布说明](docs/releasing.md) · [贡献指南](CONTRIBUTING.md) · [安全政策](SECURITY.md) · [更新记录](CHANGELOG.md)

## 功能

- **复用原有页面**：Web PC 沿用原客户端的 `FamilyCanvas` 家族网格；移动 Web 沿用原移动端的 `FocusFlowView` 聚焦纵流。用户可切换布局，窗口缩放或手机旋转不自动重置选择。
- **复杂家庭结构**：支持当前及历史配偶、养育/继亲、次要父母和干亲等关系。
- **中文亲属称谓**：计算常见的直系、旁系与姻亲称谓，并支持按家庭习惯自定义覆盖。不同地区和家庭的称谓存在差异，自动结果仍需使用者确认。
- **成员资料管理**：记录姓名、性别、出生日期、照片、籍贯和职业等信息。
- **用户自带存储**：支持目录 API 的浏览器直接读写自选普通文件夹；部署者配置 OAuth 后，也可登录自己的 Google Drive 新建或打开云端项目，无需注册应用账号。
- **跨设备使用**：同一 Google 账号通过同一 OAuth 应用访问已创建的 Drive 项目；保存采用追加版本，遇到其他设备的修改时提示处理，不自动合并。
- **数据可靠性**：打开和保存时校验项目。本地目录保留三份滚动备份并检测外部修改；Drive 保留历史版本及其照片，避免并发保存直接覆盖原内容。
- **可安装网页**：PWA 缓存静态应用供离线打开；云端项目仍需联网读写，没有离线上传队列。更新等待所有旧窗口关闭，不强制刷新编辑页面。
- **迁移与扩展**：延续 `.family` 目录和 `.familybundle` 格式，支持将已打开项目连同照片另存到 Drive；统一 IO 接口连接本地目录和云盘。

## 快速开始

### 环境要求

- 推荐 Node.js 24 LTS；支持 22.12+（22.x）、24.x 或 26+。
- 本地目录需要支持 `showDirectoryPicker` 的浏览器；推荐近期稳定版桌面 Chrome/Edge，Android Chrome 132+ 需目标设备验收。
- Google Drive 不依赖目录 API，使用支持 Google 登录弹窗、Fetch 和浏览器 WebP 图片处理的现代浏览器；Safari/iOS Safari 和 Firefox 的 Drive 流程仍需真机验收。

### 开发与构建

```bash
npm ci
npm run dev
```

在 localhost 打开后即可新建/打开普通目录、编辑成员和管理照片。发布时将 `npm run build` 生成的 `dist/` 部署到 HTTPS 静态主机。本地目录无需 Google 配置。启用 Drive 需配置公开的 Web OAuth Client ID 和网站来源，不需要 Client Secret、API Key 或业务后端，步骤见 [Google Drive 配置](docs/google-drive.md)。不需要原生工具链或购买域名。子目录、PWA 和浏览器限制见 [Web 部署说明](docs/web-deployment.md)。

### 验证改动

```bash
npm test
npm run build
npm run test:e2e
npm run test:pwa
npm run test:layout-perf
```

`test:e2e` 验证开发服务器上的目录、照片、备份与桌面/移动布局，以及替身 Google 授权/REST 下的 Drive 流程；`test:pwa` 构建生产资源，验证离线启动和更新。系统目录选择器由测试句柄替代，不能替代真机授权验收。`test:layout-perf` 使用确定性的 500 人虚构家谱执行性能门禁，建议单独运行。完整测试范围和排错方式见 [测试说明](docs/testing.md)。

## 技术概览

| 层 | 技术 |
|---|---|
| Web/PWA 与存储 | File System Access API、Google Identity Services + Drive REST、静态应用缓存 |
| 网页界面 | Vue 3、TypeScript、Pinia、Tailwind CSS |
| 数据与校验 | JSON、Zod、版本迁移与本地备份 |
| 家族树 | 家族网格与聚焦纵流双布局、共享家庭事实、Web Worker |
| 测试 | Vitest、Playwright/Chromium、类型检查与 npm audit |

核心领域逻辑位于 `src/core`，Vue 组件负责交互编排，统一存储接口连接浏览器目录与 Google Drive。不支持普通目录 API 的浏览器可使用已配置的 Drive；本地目录功能仍按浏览器能力提供。中文称谓与两套布局共享领域逻辑，大型网格计算通过 Web Worker 运行。完整边界见 [架构文档](docs/architecture.md)。

## 参与贡献

欢迎通过 Issue 和 Pull Request 参与。请先阅读 [贡献指南](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。

请勿提交真实家谱、照片、住址或其他个人信息；安全漏洞请按 [安全政策](SECURITY.md) 私下报告。

## 许可

本项目采用 [MIT License](LICENSE)。

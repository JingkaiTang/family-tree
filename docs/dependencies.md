# 依赖管理与构建边界

本轮按 2026-10-03 的稳定版依赖检查结果更新，并将项目收敛为 Web/PWA。准确版本以 `package-lock.json` 为准；升级包版本后仍需检查实际调用、类型检查、生产构建和对应回归测试。

## 工具链与兼容决策

| 项目 | 当前决策 | 原因 |
| --- | --- | --- |
| Node.js | 推荐 24 LTS；支持 22.12+（22.x）、24.x 或 26+ | 与当前 Vite/Vitest 工具链兼容，CI 使用 24 |
| TypeScript | `~6.0.3` | 已试验最新稳定版 7.0.2；`vue-tsc` 3.3.12 访问 `typescript/lib/tsc` 时出现 `ERR_PACKAGE_PATH_NOT_EXPORTED`，暂缓这一主版本升级 |
| Vue 类型检查 | `vue-tsc` 3.3.12 | 与当前 TypeScript 组合验证；未来升级需重跑类型检查与构建 |
| Node 类型定义 | `@types/node` 26.6.4 | 仅开发期类型，不代表运行时自动获得 Node 26 API；构建代码仍须在 Node 24 验证 |

本轮升级包括 Vite 8.3.2、Vitest 5.0.3、`vue-tsc` 3.3.12 和 Node 类型定义。其余直接 npm 依赖已检查稳定版本；TypeScript 是已确认冲突后保留的兼容例外。不要用强制覆盖 peer dependency 或关闭类型检查来掩盖该冲突。

## 保留与清理

| 用途 | 依赖与边界 |
| --- | --- |
| 网页 UI | Vue、Pinia、Vue Router、Tailwind CSS；桌面与手机使用现有响应式组件 |
| 数据和图片 | Zod 校验、UUID 标识、`vue-advanced-cropper` 裁剪；浏览器解码并生成主图与缩略图 |
| 家族布局 | 自有网格/纵流引擎，网格视口使用 `@panzoom/panzoom` |
| 普通目录 | 浏览器 File System Access API；`idb-keyval` 只持久化授权目录句柄，不保存项目文件 |
| Google Drive | Google 托管的 Google Identity Services 脚本处理浏览器授权；原生 `fetch` 调用 Drive v3 REST，无额外 npm SDK |
| 备份 | `@zip.js/zip.js` 处理 `.familybundle` 格式 |
| 离线应用 | `vite-plugin-pwa` 构建静态应用缓存；不缓存项目和照片 |
| 验证 | Vitest、Vue Test Utils、happy-dom、Playwright、TypeScript |

`relatives-tree` 已不参与现有布局，连同旧适配器、对应测试及孤立 fixture 移除。原生桌面和移动应用工程、Tauri API/CLI、Rust 依赖、平台桥接代码与对应 CI 已移除；项目开发和发布无需原生工具链。

Google Drive 通过统一 `ProjectStorageProvider` 接入，授权、REST 请求和版本冲突分别由连接层、客户端与适配器管理。GIS 脚本地址为 `https://accounts.google.com/gsi/client`，只有配置 Drive 的部署才需要加载；它不进入 PWA 预缓存。Google 托管脚本不受 npm 锁文件固定版本约束，升级或服务变更需通过真实 OAuth 验收。网页不包含 Client Secret，也不依赖 `gapi`、Google Picker 或 Google API Key；配置见 [Google Drive](google-drive.md)。

## 单一 Web 分发

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动浏览器开发服务器 |
| `npm run build` | Vue 类型检查并生成 `dist/` 静态网页与 PWA 资源 |
| `npm run preview` | 在本地预览构建产物 |

桌面和手机使用同一个 `dist/`，通过 HTTPS 静态主机分发。没有独立原生构建模式、SDK 别名或移动安装包；页面布局差异由共享 UI 管理，详见 [架构说明](architecture.md)。

## 后续升级与审计

使用 `npm outdated`、`npm audit` 检查版本和公告；结合依赖用途决定升级或移除，避免仅按包名数量判断冗余。至少验证干净安装、依赖树、类型检查、单元测试、生产构建、Chromium 页面流程和布局性能。

安装仍有一项已知弃用警告，来自 `vite-plugin-pwa` 1.3.0 → `workbox-build` 7.4.1 → `glob` 11.1.0。两个上游包在本次核查时已是最新稳定版，暂不强制跨主版本覆盖 `glob`，等待上游兼容更新。每次更新锁文件后重新运行审计，以当次输出判断漏洞状态。

GitHub Dependabot 的远端告警状态与本地审计是两项证据；本地检查通过不代表远端历史告警已关闭，未取得远端告警详情时不推断其编号或状态。

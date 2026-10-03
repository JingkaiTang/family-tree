# Web/PWA 测试

测试围绕当前纯 Web 架构分层，使用虚构家谱和程序生成的照片。不要把真实家庭资料放入测试或失败附件。

## 命令与覆盖范围

| 命令 | 范围 |
| --- | --- |
| `npm run typecheck` | Vue、应用与单元测试；Vite/Vitest/Playwright 配置、浏览器用例和测试服务器的严格类型检查 |
| `npm test` | 领域算法、组件、存储提供商契约、目录读写、照片、备份和保存队列 |
| `npm run build` | 完整类型检查和生产静态产物构建 |
| `npm run test:e2e` | 开发服务器上的 Chromium 流程：目录恢复、照片、备份、路由离开保存和桌面/手机布局 |
| `npm run test:pwa` | 真实生产构建、Service Worker、离线重开与多窗口更新 |
| `npm run test:layout-perf` | 500 人虚构家谱的独立布局性能门禁 |
| `npm audit --audit-level=moderate` | 锁定的 npm 依赖审计 |

配置和 E2E 使用独立的 `tsconfig.node.json`。其中 `/src/*` 映射仅用于检查开发服务器里的浏览器动态导入，不改变生产资源路径。两个类型检查入口都显式执行，不依赖 TypeScript references 隐式遍历。

## 浏览器环境

使用 Node.js 24 LTS，先运行 `npm ci` 和 `npx playwright install chromium`。Linux CI 可用 `npx playwright install --with-deps chromium` 同时安装浏览器系统依赖。也可以通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已安装的 Chromium；本地存在 `/usr/bin/chromium` 时会优先使用。

开发 E2E 使用端口 4179。生产 PWA 套件使用独立端口 4178，自动启动测试专用静态服务器并构建临时产物，无需预先运行 `npm run build` 或修改 `dist/`。测试服务器通过 Node.js 内置 TypeScript 执行能力运行，命令显式使用 `--experimental-strip-types`，兼容所声明的 Node.js 22.12+ 范围；CI 使用 Node.js 24。

两套浏览器测试只替换无法在无头环境操作的系统选择器，返回真实目录句柄，继续执行浏览器 IO。OPFS 仅是测试替身，应用不会把用户项目存入 OPFS。目录授权持久性、磁盘不足和 Android 文档提供程序仍需目标设备验收。

## 生产 PWA 回归

生产套件通过项目真实 Vite 配置生成两个版本。测试插件只给 HTML 增加版本标记，使 Workbox 正常产生不同的预缓存修订；不修改生成的 Service Worker 逻辑，也不向生产代码加入测试开关。

- 根目录和子目录部署均验证首次安装、离线重开、本地项目/照片读取、懒加载页面与布局 Worker。缓存检查确保只有静态应用资源，没有家谱或照片。
- 两个旧版窗口保持打开时，新版必须等待；窗口不能自动刷新，编辑中的输入必须保留。关闭全部旧窗口后，新版才能接管。
- 更新资源加载失败时，旧版仍须可以离线打开，不能破坏已有离线缓存。

浏览器退出和系统杀进程不能保证异步写入完成。保存队列测试覆盖失败后保持脏状态、后续重试与项目隔离，不把这些测试解释为系统级持久化保证。

## CI 与排错

CI 在执行单元测试、生产构建后运行开发 E2E、生产 PWA 和独立性能检查。Playwright 在 CI 禁止 `test.only`；Vitest 默认也会拒绝 focused tests，防止误留下局部测试导致全套被跳过。

浏览器失败时保留 trace 和截图。CI 上传 `browser-test-failures` 附件，保留 7 天。本地可通过 `PLAYWRIGHT_OUTPUT_DIR` 和 `PLAYWRIGHT_PWA_OUTPUT_DIR` 指定各套件输出位置；默认写入系统临时目录，不提交生成文件。

用 `npx playwright show-trace <trace.zip>` 查看失败步骤。先检查具体断言、浏览器异常和网络请求，再决定是否重跑；不要用重复运行代替故障定位。性能门禁应在没有其他重型任务时单独运行；它验证布局核心，不代替大项目的浏览器交互帧率与 Worker 传输成本验收。

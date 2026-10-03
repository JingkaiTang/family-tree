# Web/PWA 部署与本地目录

Web/PWA 是桌面与移动设备的共享应用入口。家谱和照片直接写入用户授权的普通目录，不需要应用账号、业务后端、数据库或 Google OAuth 配置。原生客户端复用同一套界面和领域逻辑，保留平台能力与旧项目迁移路径。

## 浏览器范围

本次只支持具备普通目录 API 的浏览器，不提供 OPFS/IndexedDB 项目存储降级。

| 浏览器 | `showDirectoryPicker` 的 API 门槛 | 本项目使用建议 |
| --- | --- | --- |
| 桌面 Chrome | 86，2020-10-06 | 近期稳定版，并验证目录权限和图片处理 |
| 桌面 Edge | 86，2020-10-09 | 近期稳定版，并验证目录权限和图片处理 |
| Android Chrome | 132，2025-01-14 | 132+，仍需目标手机/文档提供程序验收 |
| Safari、iOS Safari、Firefox | 当前不支持 | 网页显示不支持；iOS 可使用原生客户端 |

版本依据为 [MDN 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)、[Chrome 86 发布公告](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/blog/new-in-chrome-86/index.md)、[Edge](https://github.com/mdn/browser-compat-data/blob/main/browsers/edge.json)与 [Android Chrome](https://github.com/mdn/browser-compat-data/blob/main/browsers/chrome_android.json)版本记录，核查日期为 2026-10-03。这些是 API 门槛，并非完整应用的最低版本承诺；当前 Vite 默认构建目标包含 Chrome/Edge 111，界面和其他运行时 API 也需要验证。

选择目录和重新授权必须由用户点击触发。正式访问使用 HTTPS，开发可用 localhost；手机访问电脑的普通局域网 HTTP IP 通常不属于安全上下文。跨域 iframe 不支持选择/重新授权，请独立打开站点网址。安装为 PWA 不会补齐浏览器缺失的目录能力。

## 开发与部署

```bash
npm ci
npm run dev

npm run build
npm run preview
```

`dev` 用于开发；生产 PWA 由 `build` 生成，可通过 `preview` 在本地验收。将完整 `dist/` 上传到任何 HTTPS 静态主机即可。主机赠送的 HTTPS 子域名也可使用，不必购买域名。

默认资源路径为 `./`，同一产物可以部署到根目录或 `/family/` 等子目录；目录网址应带尾斜杠，主机应把 `/family` 重定向到 `/family/`。如主机要求固定路径，可复制 [.env.example](../.env.example) 为 `.env.local`，设置 `VITE_BASE_PATH=/family/` 后重新构建。项目使用 hash 路由，地址类似 `/family/#/tree`，不需要服务端业务路由或 SPA 重写规则。

建议配置缓存响应头：

| 文件 | 缓存建议 |
| --- | --- |
| `index.html`、`sw.js`、`manifest.webmanifest` | `Cache-Control: no-cache`，允许及时验证新版本 |
| 带内容哈希的 `assets/*`、`workbox-*.js` | `Cache-Control: public, max-age=31536000, immutable` |
| 固定文件名的图标 | 短缓存或重新验证 |

确保 JS、CSS、PNG、manifest 返回正确 MIME 类型；更新时完整部署构建产物。静态主机不需要存储用户家谱，也不需要跨域访问磁盘目录的 CORS 配置。

## 目录使用与迁移

1. 点击“新建家族”，选择空目录；或点击“打开”选择含 `meta.json`、`family.json` 的已有项目。
2. 授予读写权限。目录句柄保存在本站 IndexedDB，家谱和照片保存在普通目录，浏览器不保存第二份项目库。
3. 重开网页时检查最近目录权限；失效时点击重新授权，或重新选择原目录。
4. 导出 `.familybundle` 或复制完整项目目录作为备份。导入备份分两次点击：先选文件，再选空目录，避免浏览器用户激活限制。

桌面原生项目可先保存并关闭，再用 Web 直接打开同一个 `.family` 目录。原生手机的项目在 AppData 中：先从原生客户端导出 `.familybundle`，再在支持的浏览器中导入到空目录。格式说明见 [project-format.md](project-format.md)。

清除站点数据会删除最近记录、目录句柄和应用缓存，不会删除普通目录里的项目。换域名、协议或端口后也需要重新选择目录。只有手机原生应用的卸载可能同时删除其私有项目，因此应先导出备份。

## 保存、离线与容量边界

- 普通目录文件不使用 IndexedDB/OPFS 的站点配额，仍受实际磁盘空间、系统权限和文件系统限制。大量照片按需读取；导入的主图会缩放，不能作为原始影像归档。
- 首次联网打开并完成静态资源缓存后，可以离线重新打开 PWA。目录授权仍由浏览器决定，首次授权和授权恢复需要用户操作。
- PWA 仅缓存应用静态资源，不缓存项目、照片或登录令牌。新版下载后等待所有旧窗口关闭，再自然激活；不强制刷新正在编辑的窗口。
- 自动保存、页面隐藏时的刷新和卸载提示不能保证浏览器被杀死后完成异步写入。离开前确认“已保存”，使用应用的关闭项目流程。
- 同来源窗口使用 Web Locks 串行执行目录 IO；保存还比较磁盘内容，发现外部变化时拒绝覆盖。不同来源、原生客户端或其他程序不参与同一把锁，检查与提交也不是跨程序原子事务，请避免同时编辑同一目录。
- 本地目录与 PWA 不提供跨设备自动同步。Google Drive 仍是后续适配器，需要另外实现 OAuth、账号隔离、远端版本协调与冲突恢复。

## 需要准备什么

开发和本地目录使用无需提供密钥。部署时只需确认静态主机网址/子路径，以及目标浏览器、操作系统和设备型号。若需要原生 iOS 包，再准备 macOS/Xcode、Apple Development Team 与设备；Android 原生包需要 SDK/NDK 和设备，正式分发另配签名。凭据在本机或 CI 中配置，不写入静态网页或仓库。

## 验收范围

`npm run test:e2e` 使用真实 Chromium，覆盖共享网页在无 Tauri 进程时的交互与文件 API。无头环境无法操作系统目录对话框，因此测试选择器返回真实 OPFS 句柄作为替身，验证读写、Blob、Web Locks 和 IndexedDB 克隆；**生产应用不使用 OPFS**。

自动化不代表系统目录选择、权限持久性或 Android 文档提供程序已通过真机验收。发布前应在目标桌面与 Android Chrome 验证选空目录、新建/重开、撤销授权、上传照片、备份互导、磁盘不足/保存冲突，以及 PWA 离线重开。原生 iOS/Android 验收另见 [移动端开发](mobile-development.md)。

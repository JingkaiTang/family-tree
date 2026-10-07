# Web/PWA 部署与存储

Web/PWA 是桌面与移动设备的共享应用入口。家谱和照片直接写入用户授权的普通目录或 Google Drive，不需要应用账号、业务后端或数据库。本地目录无需 Google 配置；Drive 是通过公开 Web OAuth Client ID 启用的可选存储，配置见 [Google Drive](google-drive.md)。Web PC 直接使用原客户端的 `FamilyCanvas` 家族网格，移动 Web 直接使用原移动端的 `FocusFlowView` 聚焦纵流，复用现有组件、表单和业务流程。项目只维护 Web/PWA，已移除原生桌面与移动应用工程。

浏览器在启动时依据设备信息决定默认布局。普通 PC 缩窄窗口仍保留家族网格，手机横屏仍保留聚焦纵流；工具栏和表单按当前视口响应式排布。用户手动选择的布局优先，并在该设备保存。

## 浏览器范围

以下表格仅说明**本地目录功能**；它要求普通目录 API，不提供 OPFS/IndexedDB 项目存储降级。Drive 功能不依赖目录 API，需现代浏览器支持 GIS 登录弹窗、Fetch、Blob 与浏览器 WebP 图片处理。Firefox、Safari/iOS Safari 的 Drive 流程尚需目标设备验收，不以目录 API 的缺失直接排除，也不把 Chromium 测试当作这些浏览器已通过验证。

| 浏览器 | `showDirectoryPicker` 的 API 门槛 | 本项目使用建议 |
| --- | --- | --- |
| 桌面 Chrome | 86，2020-10-06 | 近期稳定版，并验证目录权限和图片处理 |
| 桌面 Edge | 86，2020-10-09 | 近期稳定版，并验证目录权限和图片处理 |
| Android Chrome | 132，2025-01-14 | 132+，仍需目标手机/文档提供程序验收 |
| Safari、iOS Safari、Firefox | 当前不支持 | 本地目录功能不可用；可使用已配置的 Drive，须真机验收 |

版本依据为 [MDN 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)、[Chrome 86 发布公告](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/blog/new-in-chrome-86/index.md)、[Edge](https://github.com/mdn/browser-compat-data/blob/main/browsers/edge.json)与 [Android Chrome](https://github.com/mdn/browser-compat-data/blob/main/browsers/chrome_android.json)版本记录，核查日期为 2026-10-03。这些是目录 API 门槛，并非完整应用的最低版本承诺；项目使用 Vite 的默认现代浏览器构建目标，界面和其他运行时 API 也需要验证。

选择目录和重新授权必须由用户点击触发。正式访问使用 HTTPS，开发可用 localhost；手机访问电脑的普通局域网 HTTP IP 通常不属于安全上下文。跨域 iframe 不支持选择/重新授权，请独立打开站点网址。安装为 PWA 不会补齐浏览器缺失的目录能力。

## 开发与部署

推荐 Node.js 24 LTS；开发和构建只需网页工具链。支持的 Node 范围及依赖升级约束见 [依赖管理](dependencies.md)。

```bash
npm ci
npm run dev

npm run build
npm run preview
```

生产 PWA 由 `build` 生成，可通过 `preview` 在本地验收。将完整 `dist/` 上传到任何 HTTPS 静态主机即可。主机赠送的 HTTPS 子域名也可使用，不必购买域名。

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

旧版桌面项目可先保存并关闭，再用 Web 直接打开同一个 `.family` 目录。若仍持有历史手机应用安装，其私有目录项目需先从该安装导出 `.familybundle`，再在支持的浏览器中导入到空目录；卸载历史应用前先确认备份可恢复。当前仓库不再构建这些旧版应用。格式说明见 [project-format.md](project-format.md)。

清除站点数据会删除最近记录、目录句柄和应用缓存，不会删除普通目录里的项目。换域名、协议或端口后也需要重新选择目录。

## 保存、离线与容量边界

- 普通目录文件不使用 IndexedDB/OPFS 的站点配额，仍受实际磁盘空间、系统权限和文件系统限制。大量照片按需读取；导入的主图会缩放，不能作为原始影像归档。
- 首次联网打开并完成静态资源缓存后，可以离线重新打开 PWA。目录授权仍由浏览器决定，首次授权和授权恢复需要用户操作。
- PWA 的 Service Worker 仅缓存应用静态资源，不缓存项目、照片或登录令牌。Drive 认证模块在 localStorage 单独保存短期连接，详见 [Google Drive](google-drive.md)。新版下载后等待所有旧窗口关闭，再自然激活；不强制刷新正在编辑的窗口。
- 自动保存、页面隐藏时的刷新和卸载提示不能保证浏览器被杀死后完成异步写入。离开前确认“已保存”，使用应用的关闭项目流程。
- 同来源窗口使用 Web Locks 串行执行目录 IO；保存还比较磁盘内容，发现外部变化时拒绝覆盖。不同来源或其他程序不参与同一把锁，检查与提交也不是跨程序原子事务，请避免同时编辑同一目录。
- 本地目录与 PWA 不提供跨设备自动同步。Drive 可在同账号、同 OAuth 应用下跨设备打开项目，但不持续拉取远端变化或维护离线上传队列；并发版本由用户显式处理。云端未保存编辑仅在页面内存中，网络恢复后须确认已保存；草稿 JSON 救援不含照片。

## 需要准备什么

开发和本地目录使用无需提供密钥。部署时需确认静态主机网址/子路径，以及目标浏览器、操作系统和设备型号。启用 Drive 还需启用 Google Drive API、配置公开的 Web OAuth Client ID 和 Authorized JavaScript origins，并按 Google 控制台处理受众与发布要求；`.env.local` 配置随构建生效，详见 [配置步骤](google-drive.md)。不需要 Client Secret、API Key、移动 SDK、应用商店账号或签名凭据。静态主机的部署凭据只配置在本机或 CI，不写入网页或仓库。

## 验收范围

`npm run test:e2e` 使用真实 Chromium，覆盖网页交互与文件 API，以及 PC/移动布局、窄桌面窗口、手机横屏和显式偏好。无头环境无法操作系统目录对话框，因此测试选择器返回真实 OPFS 句柄作为替身，验证读写、Blob、Web Locks 和 IndexedDB 克隆；**生产应用不使用 OPFS**。

`npm run test:pwa` 单独构建生产产物，覆盖根目录/子目录部署、离线重开与懒加载、多窗口更新等待以及更新失败时旧缓存继续可用。此套件使用真实 Service Worker；运行方法和测试边界见 [测试说明](testing.md)。

Drive 浏览器回归使用替身 Google 登录服务和 Drive REST，不访问真实用户数据。发布前还需用实际 Client ID 验证 Google 授权、取消/过期/撤销、错账号重连、跨设备列表、照片、冲突及无保存选择器的备份下载。

自动化不代表系统目录选择、权限持久性或 Android 文档提供程序已通过真机验收。本地目录应在目标桌面与 Android Chrome 验证选空目录、新建/重开、撤销授权、上传照片、备份互导、磁盘不足/保存冲突，以及 PWA 离线重开。Safari/iOS Safari 当前不支持目录 API，安装为 PWA 也不能获得这项能力；其 Drive 能力独立验收。

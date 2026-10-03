# 纯前端分发与用户自带存储

日期：2026-10-03。当前明确目标：应用可以自行静态部署，不建立应用自己的账号体系，**优先使用用户选择并授权的普通本地目录保存家谱**，已有云盘连接作为后续可选能力。这是后续选型的约束；集中式 Supabase 用户管理不作为默认路线。[浏览器最低版本、发布日期与限制](./local-directory-browser-support.md)

两种主要路线的部署、浏览器覆盖、容量与同步成本，见[普通本地目录与 Google Drive 对比](./local-directory-vs-google-drive.md)。

后续实现进度：已抽出统一项目与媒体存储接口并接入现有 Tauri 适配器，详见[存储接口说明](../storage.md)。浏览器目录及云盘实现仍待接入；以下选型边界继续适用。

**建议架构**

采用 Vue/PWA 与存储适配器，优先实现浏览器本地目录访问。应用负责家谱编辑、照片处理、格式校验、保存队列和恢复；完整项目与图片存入用户授权的普通目录，浏览器内部只保存必要的句柄、偏好和可重建缓存。后续连接云盘时，由存储服务负责自身账号认证。无需开发者运营应用用户数据库或中央授权代理。

```text
桌面浏览器 / 手机浏览器 / 安装的 PWA
                 │
         静态 Vue 家族树应用
                 │
           存储适配器
       ┌─────────┴─────────┐
  用户授权的普通本地目录    可选云盘连接
       首版优先           后续评估
```

此图描述可扩展边界，不表示第一版同时实现所有适配器。用户已选择先实现本地目录读写；不支持目录接口的平台需要另定导入导出或云盘方案。现有领域逻辑可复用；Tauri 项目读写和 Rust 照片处理需要浏览器实现。[现有架构](../architecture.md#L27)、[存储接口](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/tauriApi.ts#L1)

**静态分发与授权配置**

本地目录模式不需要 Google OAuth 应用配置。以下配置只针对后续可选网盘连接：支持部署到不同静态主机，但不承诺任意新地址无需配置就能完成网盘授权。配置属于部署者，普通使用者只需连接自己的网盘账户。

| 场景 | 部署者需要做什么 | 使用者需要做什么 |
| --- | --- | --- |
| 维护者提供的站点 | 注册云盘 OAuth 应用，登记网站来源或回调地址，设置客户端公开标识 | 选择存储服务并完成其登录和授权 |
| 他人自行部署 | 配置自己的 OAuth Client ID / app key，按所选服务登记本站来源或回调地址 | 登录自己的存储账号；不需要人人注册开发者应用 |
| 连接 WebDAV | 确认目标服务允许来自本站的浏览器请求，配置可达的 HTTPS 服务 | 填写服务地址和适用的凭据；Nextcloud 可使用应用密码 |

已核实的限制：

- Google 官方浏览器示例明确指出，网页 host/port 不匹配登记的 Authorized JavaScript origins 会出现 `origin_mismatch`。GIS token 弹窗流程可以由浏览器直接获取令牌调用 Drive；不同授权流程的回调配置不能混为一谈。[来源登记](https://github.com/googleworkspace/browser-samples/blob/main/README.md#L61)、[Drive token 示例](https://github.com/googleworkspace/browser-samples/blob/main/drive/quickstart/index.html#L77)
- Microsoft 不会将用户或令牌发送到未登记的 redirect URI；浏览器 Vue 应用需要按 SPA 配置，正式地址通常要求 HTTPS。[官方回调文档](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity-platform/reply-url.md#why-do-redirect-uris-need-to-be-added-to-an-app-registration)
- Dropbox 浏览器 SDK 支持授权码加 PKCE，使用 app key，不应在浏览器中嵌入 app secret；正式回调地址需按官方要求登记。[JS SDK](https://github.com/dropbox/dropbox-sdk-js/blob/main/README.md#browser-authentication-and-pkce)、[OAuth 源码文档](https://github.com/dropbox/dropbox-sdk-python/blob/main/dropbox/oauth.py#L418)
- 浏览器跨域请求取决于目标服务器返回的 CORS 响应头。WebDAV 能被桌面客户端访问，并不能证明它支持任意网站的浏览器连接；纯前端无法单方面修复目标服务器拒绝跨域的问题。[Nextcloud 安全文档](https://github.com/nextcloud/documentation/blob/master/developer_manual/prologue/security.rst#L275)、[MDN CORS](https://github.com/mdn/content/blob/main/files/en-us/web/http/guides/cors/index.md)

建议将非秘密的部署配置与静态代码分开，包含启用的提供商和公开 Client ID / app key；无需让每位使用者修改构建代码。密钥和令牌仍需区分：不将 client secret 写入静态产物，用户授权令牌由相应 SDK 的浏览器流程管理。这是拟议设计，尚未实现。

**项目行为建议**

- 打开应用后选择并授权项目目录，无需注册家族树账号；后续需要同步时再评估“连接云盘”。
- 本地修改保存到选定目录，显示保存中、已保存、保存失败或需重新授权；恢复目录句柄时检查权限。
- 云盘功能若实现，应按存储提供商、远端账户与项目隔离缓存，显示待同步、同步完成和冲突状态。当前自动保存只保护同一进程的修订状态，需另外设计并发与跨设备处理。[当前保存逻辑](../../src/services/autosave.ts#L49)
- 云盘令牌续期和重新授权按各提供商的浏览器流程处理，不承诺页面关闭后持续同步。
- 保留项目 JSON 和照片的完整归档导出。跨域名、跨 OAuth 应用配置后应实际验证旧项目是否仍可发现和访问；不能只凭使用同一个云盘账户就跳过这项验证。
- 桌面和手机可共用网页界面，但不能假定具有相同的目录访问能力；若继续维护 Tauri 原生包，单独验证其平台存储适配和可选云盘授权回流。

**纯网页本地文件存储的可行性**

支持 File System Access API 的浏览器可以通过 `showDirectoryPicker({ mode: 'readwrite' })`，在用户主动选择并授权的文件夹内读写文件。需要安全上下文和用户操作触发；网站不能自行取得任意磁盘目录的访问权限。[MDN 目录选择文档](https://github.com/mdn/content/blob/main/files/en-us/web/api/window/showdirectorypicker/index.md)

2026-10-03 读取的 MDN 兼容数据将 `showDirectoryPicker`、`showOpenFilePicker` 和 `showSaveFilePicker` 标为桌面 Chrome 86 起、Android Chrome 132 起支持，Edge 跟随 Chromium；Firefox、Safari 和 iOS Safari 列为不支持。实现时仍需能力检测与目标设备验证，不应再笼统称手机浏览器都不支持。[MDN 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)

用户已将网页直接读写现有 `.family` 目录选为优先路线，保留 `meta.json`、`family.json` 和媒体结构。仍需实现浏览器存储和图片处理，并重新设计备份与中断恢复；不能直接调用当前 Rust 命令或继承其临时文件加 rename 的保存保证。[项目格式](../project-format.md#L5)、[现有 Rust 保存](../../src-tauri/src/commands/project.rs#L268)

不支持目录读写时，可评估 IndexedDB 或 OPFS 保存本地数据，再提供包含照片的完整归档导入导出。OPFS 是按网站来源隔离、通常不直接向用户展示的浏览器私有存储，受容量管理影响，清除站点数据会删除它；它与用户主动选择的普通文件夹不同。[MDN OPFS](https://github.com/mdn/content/blob/main/files/en-us/web/api/file_system_api/origin_private_file_system/index.md)

本地保存不自动带来跨设备同步。建议将本地目录、浏览器私有存储和网盘连接作为不同能力处理，并明确当前数据保存在哪里。通过嵌入式预览运行时还需检查同源与交互限制，独立站点网址上的行为应单独验证。

**大量图片与浏览器配额**

2026-10-03 查阅 MDN 后确认，不能把 `localStorage` 的小容量限制套用到全部浏览器存储。`localStorage` 通常为每来源 5 MiB，另有 5 MiB 的 `sessionStorage`；IndexedDB、Cache 与 OPFS 使用浏览器管理的另一套配额，容量可以达到 GB 级。Chrome/Edge 文档给出的单来源配额上限可到总磁盘的 60%，但这是计算上限，不是预留空间或实际可写入量，仍受剩余空间等条件限制。[配额与回收规则](https://github.com/mdn/content/blob/main/files/en-us/web/api/storage_api/storage_quotas_and_eviction_criteria/index.md)

浏览器默认存储可能因空间压力被回收；用户清除站点数据也会删除内容。`navigator.storage.persist()` 可申请持久模式，但浏览器可以拒绝，获准后仍不能阻止用户主动清除；`navigator.storage.estimate()` 仅给出近似使用量与配额。不能把这些 API 当作无限容量或永久备份保证。[持久模式](https://github.com/mdn/content/blob/main/files/en-us/web/api/storagemanager/persist/index.md)、[容量估计](https://github.com/mdn/content/blob/main/files/en-us/web/api/storagemanager/estimate/index.md)

针对大量家谱图片，建议完整项目放在用户选择的普通本地目录或用户网盘，浏览器内部主要保存家谱索引、缩略图和近期访问的图片。选择普通本地目录的访问接口与 OPFS 应区分处理，前者还受实际磁盘空间、文件权限和文件系统限制。[文件访问与 OPFS 的区别](https://github.com/mdn/content/blob/main/files/en-us/web/api/file_system_api/origin_private_file_system/index.md)

缓存管理属于拟议实现：图片使用二进制 Blob，按需加载，分别控制磁盘缓存和解码内存；应用自己的缓存淘汰不得删除未同步编辑、待上传照片或冲突副本。尽快将这些唯一修改保存到选定主存储，不能假定它们能抵御浏览器整站清理。

现有 `.family` 已分开 JSON、照片和缩略图；主图最长边会缩至 1600px，缩略图为 256px，因此当前主图不一定是用户导入的原始分辨率文件。如果后续需要家庭原始影像归档，应另外明确原始文件保留策略，不将缩略图或处理后的主图当作原始照片备份。[媒体格式](../project-format.md#L85)

本次确立了本地目录优先的目标并核实部署、浏览器能力边界，尚未实现浏览器存储或同步协议，也未操作用户账号或部署站点。各云盘服务的审核、额度和浏览器令牌行为仍需在选定具体提供商后验证。

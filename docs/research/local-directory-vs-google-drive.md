# 普通本地目录与 Google Drive 对比

> 历史调研：正文记录实现前的候选方案与当时代码，不代表当前功能。项目现已仅保留 Web/PWA，已实现浏览器普通目录、图片处理和备份；原生工程已移除，Google Drive 适配已接入，配置与限制见 [Google Drive](../google-drive.md)。当前支持范围以 [Web 部署说明](../web-deployment.md) 为准，架构与 IO 见 [架构说明](../architecture.md) 和 [存储接口](../storage.md)。

日期：2026-10-03。范围：纯前端静态分发、不运营应用账号系统、大量家谱图片与数据、桌面和手机访问。本轮只核查资料、审查项目并整理方案，没有实现、部署或操作用户 Google 账号。

## 决策建议

继续以用户授权的普通本地目录作为第一版主存储，优先满足自由部署、文件可控和大量图片本地读写。这是工程建议，符合用户当前明确选择。

如果第一版必须支持 iPhone / iPad 与电脑频繁交替编辑同一项目，则本地目录单独不能满足目标。Google Drive 更适合作为跨设备的可选主存储，代价是 OAuth 配置、联网依赖、缓存和同步可靠性工作。Drive 不依赖普通目录选择器，但其 Safari / iOS 授权与 PWA 体验仍需实际验证；本轮未核实最新 GIS 浏览器支持矩阵。

## 已核实事实与工程影响

| 维度 | 用户授权普通本地目录 | 用户 Google Drive |
| --- | --- | --- |
| 自建后端与账号 | 目录读写不要求应用账号或业务后端 | 浏览器可直接取得访问令牌并访问 Drive，不要求自建业务后端或账号数据库；用户授权自己的 Google 账号 [1] |
| 静态分发 | 在支持接口的浏览器中，通过安全上下文和用户点击授权目录 [2] | 部署者需要 OAuth 客户端及相应网站来源配置；换地址需核对登记，来源不匹配会报 `origin_mismatch` [3] |
| 对外开放 | 不涉及 Google OAuth 审核 | 需要处理应用发布配置及适用的验证要求；最小权限不等于保证免除所有验证，现行政策仍待核实 |
| 浏览器覆盖 | 桌面 Chrome / Edge、较新 Android Chrome 是候选；Safari / Firefox 当前缺少目录选择接口，版本见[兼容矩阵](local-directory-browser-support.md) | 云 API 不要求 `showDirectoryPicker()`；可用于规划 Safari / iOS 路线，但不能据此承诺所有浏览器及 PWA 授权流程已通过测试 [1] |
| 主数据容量 | 受实际磁盘、系统权限和文件系统限制，普通目录不占 IndexedDB / OPFS 站点配额 [2][4] | 受用户或组织的 Google 存储额度限制；Drive API 的 `About.storageQuota` 提供额度与使用量 [5] |
| 大量照片 | 可按需读取目录中的缩略图、主图，不必把整库复制到浏览器私有存储 | 可把整库存远端、只下载和缓存当前需要的文件；首次取用需网络传输，需处理失败和重试 [5] |
| 离线使用 | 数据在本机；应用代码也需离线缓存，才能在断网时重新启动网页 [6] | 离线可用范围取决于已缓存的数据；完整离线照片库仍受所用本地存储的容量与回收规则约束 [4][6] |
| 跨设备 | 不自动同步；需用户搬运完整项目或另行提供同步能力 | 各设备可以访问同一份远端文件，但应用需要实现同步、版本检查和冲突恢复 [5] |
| 重新打开 | 恢复句柄后检查权限，必要时由用户重新授权 [7] | 处理访问令牌过期、撤销与重新获取；不等于每次都重新输入密码 [1] |
| 数据位置与备份 | 文件位于用户目录，可复制整目录备份；同一磁盘中的唯一副本不是独立备份 | 文件上传到 Google；远端存储不自动提供应用级完整快照或冲突合并，仍需可恢复版本和导出 [5] |
| 相对改造量 | 新增浏览器存储、照片处理、权限恢复和可靠保存 | 除网页照片处理外，还需 OAuth、账号隔离、远端文件映射、待同步队列及冲突管理 |

表中的相对改造量、缓存方案和路线选择属于工程判断，不是已实现功能或性能测量结果。两种方案的网页 UI 都仍需移动适配。

## Google 授权方面的准确边界

优先评估 `drive.file`，其官方定义是访问应用使用的特定文件；无需因为存储家谱就默认申请整个 Drive 读写权限。`drive.appdata` 的官方描述是应用自己的配置数据，仅此权限也不能调用 `permissions.create` 分享 API，因此不应把它当作现成的家族共享方案。[5]

Google 官方浏览器示例使用 `initTokenClient()` 和 `requestAccessToken()`，不要求前端嵌入 client secret，也未实现长期保存 refresh token。过期后重新获取访问令牌的体验要验证；页面关闭后不能保证纯前端继续上传尚未发送的修改。[1][8]

External + Testing 下 refresh token 七天失效有官方 SDK 依据，但该限制针对使用 refresh token 的流程，不能直接解释成纯 GIS token 模式“用户每七天必须重新登录”。[9]

此前读取到 Google Workspace 官方组织示例把 `drive.file` 标为推荐、非敏感权限；该示例注明并非正式支持的 Google 产品，因此不用于保证公众发布免审。[10] 现行品牌、域名及权限验证政策正文受环境网络限制尚未成功读取，详见[已有政策核验边界](public-web-google-drive.md)。普通用户不需要各自创建开发者项目；OAuth 客户端配置属于站点提供者或自行部署者的工作。[1][3]

## 对家谱项目的具体影响

项目当前已经是普通 `.family` 目录，包含 JSON、照片、缩略图和备份。[项目格式](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L5) 本地目录方案可保留该格式，以浏览器句柄替换 [Tauri 路径接口](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/tauriApi.ts#L13)。Drive 可以保留逻辑结构，但应使用稳定项目标识与 Drive 文件 ID，并维护 `photoId → fileId` 映射，不能依靠可重名的文件名定位。[5]

两种路线都需要浏览器照片处理。当前主图最长边缩至 1600px、缩略图为 256px，主图不一定保留导入文件的原始分辨率；更换存储不会自动变成原件归档功能。[照片规则](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L85)

当前保存的是整份 `family.json`，[自动保存的修订号](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/autosave.ts#L49)只保护同一进程中的保存状态。例如电脑和手机从同一旧版本开始编辑，先后上传整份 JSON，直接覆盖会丢失另一端修改。Drive 的文件版本号可用于发现变化，但“读取版本再上传”本身不是无竞争的原子锁。[5] 同一个本地目录同时被网页和桌面应用修改，也需要并发保护。

拟议保存策略：本地目录单独设计浏览器备份与中断恢复；Drive 则先保证媒体上传成功，再提交引用媒体的家谱版本，并保留冲突副本。多文件上传不能直接当作整项目事务，不能照搬 Rust 保存与本地照片 GC 的保证。[当前恢复机制](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L77)、[当前媒体清理](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src-tauri/src/commands/media.rs#L143)

建议先抽出统一的项目与媒体存储接口，完成本地目录模式；日后增加可选 Drive 项目并支持完整导入导出。将“本地项目迁移到 Drive”与“同一项目长期双向同步”分开评估，后者需要额外同步协议。仅做云端备份也可分阶段实现，但不能据此声称已经支持手机持续编辑同一项目。

若通过 ChatGPT Sites 分发，本地模式需在独立 HTTPS 站点测试目录授权；Drive 模式还需为实际网站来源配置 OAuth。ChatGPT 中已连接的 Drive 工具授权不能直接视为发布网站获得的访问令牌。

## 来源与验证边界

[1]: https://github.com/googleworkspace/browser-samples/blob/main/drive/quickstart/index.html#L77
[2]: https://github.com/mdn/content/blob/main/files/en-us/web/api/window/showdirectorypicker/index.md
[3]: https://github.com/googleworkspace/browser-samples/blob/main/README.md#L61
[4]: https://github.com/mdn/content/blob/main/files/en-us/web/api/file_system_api/origin_private_file_system/index.md
[5]: https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json
[6]: https://github.com/mdn/content/blob/main/files/en-us/web/progressive_web_apps/guides/making_pwas_installable/index.md
[7]: https://github.com/mdn/content/blob/main/files/en-us/web/api/filesystemhandle/querypermission/index.md
[8]: https://github.com/mdn/content/blob/main/files/en-us/web/api/window/beforeunload_event/index.md
[9]: https://github.com/googleapis/google-api-nodejs-client/blob/main/README.md#L253
[10]: https://github.com/googleworkspace/redriveapp/blob/main/README.md#L8

本轮重新读取 Google Drive 官方 Discovery 的权限、下载接口、版本号和容量字段，并结合前轮已读取的官方样例、MDN 及项目代码。尚未进行 OAuth 登录、真实 Drive 读写、双设备冲突实验或浏览器功能验收；未对当前费用、精确调用额度或审核时长作承诺。

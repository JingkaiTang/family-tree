# 家族树云存储替代方案

> 历史调研：正文记录实现前的候选方案与当时代码，不代表当前功能。项目现已仅保留 Web/PWA，已实现浏览器普通目录、图片处理和备份；原生工程已移除，Google Drive 尚未实现。当前支持范围以 [Web 部署说明](../web-deployment.md) 为准，架构与 IO 见 [架构说明](../architecture.md) 和 [存储接口](../storage.md)。

调研日期：2026-10-03。本文延续[公开网页与 Google Drive 调研](public-web-google-drive.md)，比较个人开发者可以考虑的存储路线。结论为选型建议，本次未接入账户、测试服务或部署应用。

当前已明确要求纯前端分发、无应用账号、用户自行连接存储服务。后续以[纯前端与用户自带存储方案](static-frontend-user-storage.md)为准；本文中的集中托管方案保留作比较，不作为默认路线。

最接近 Google Drive 的替代是 OneDrive 和 Dropbox：用户授权应用使用自己的存储空间。Supabase、Firebase 则提供应用项目中的数据库与文件存储，由开发者配置用户权限并管理服务资源。Nextcloud / WebDAV 可以连接用户已有的私有云，也可以由开发者提供实例。

| 方案 | 已核实能力与来源 | 对家族树的建议及责任边界 |
| --- | --- | --- |
| OneDrive + Microsoft Graph | 专属应用目录权限 `Files.ReadWrite.AppFolder`，支持个人与工作/学校账户；可上传、列举和分享目录内文件，目录占用户或对应站点额度。[微软文档](https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/concepts/onedrive-sharepoint-appfolder.md) | 与目前 JSON + 照片结构贴合；公众个人用户按委托授权评估。仍需应用注册、用户同意及具体发布条件核对 |
| Dropbox API / App folder | 官方教程说明 App folder 限制在授权用户的单一文件夹；官方 SDK 支持浏览器与 Node.js，浏览器采用授权码与 PKCE。[SDK](https://github.com/dropbox/dropbox-sdk-js/blob/main/README.md#browser-authentication-and-pkce)、[官方教程](https://github.com/dropbox/nodegallerytutorial/blob/04db9409c1b4684869e58729c7c1f425baee7a4b/README.md) | 可保存项目和照片，适合个人跨设备同步；App folder 辅助依据来自较早教程，当前公开发布规则和限制需再核对 |
| Nextcloud / WebDAV | 远程创建、读取、编辑文件，可用可撤销的应用密码连接具体实例。[官方手册](https://github.com/nextcloud/documentation/blob/master/user_manual/files/access_webdav.rst) | 适合已有私有云或愿意自主部署的用户。需要明确谁提供服务器和账户；接入用户自有实例会增加配置与支持工作 |
| Supabase | 托管 Postgres、认证、文件存储及实时订阅；也可自行部署。[官方项目说明](https://github.com/supabase/supabase/blob/master/README.md#supabase) | 值得作为面向普通用户、未来支持家人协作的候选；开发者负责项目资源、数据权限和运行费用，用户无需先准备网盘 |
| Firebase | 官方 JavaScript SDK 包含项目级 Firestore、Realtime Database、Storage 和 Authentication 接入。[官方 SDK](https://github.com/firebase/firebase-js-sdk/blob/main/README.md#test-setup) | 可作为应用后端候选；仍属于 Google 服务，数据位于应用项目的数据库/存储桶，不是用户的个人 Drive。套餐和计费要求需另核对 |

**基于现有项目的选择建议**

如果希望延续“数据归用户自己的网盘、开发者少承担集中存储”的方向，优先对比 Google Drive 与 OneDrive；Dropbox 可以作为后续适配。现有项目已经把家谱 JSON 与照片分开，文件型存储适配具有基础。[项目格式](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L5)

如果希望普通用户直接注册使用，并逐步支持亲人共同维护，建议优先评估 Supabase：Postgres 保存家谱和关系，Storage 保存照片，Auth 管理用户。官方支持邮箱密码登录，因此用户不必为了这条路线授予 Google Drive 权限。[邮箱登录文档](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/passwords.mdx#with-email)

这项建议不意味着 Supabase 自动处理家谱协作。开发者仍需定义家谱成员资格、查看/编辑权限、跨记录关系完整性和冲突策略。Storage 官方文档提供基于 RLS 的用户隔离策略，但策略需要开发者正确配置；拥有登录状态不代表自动得到正确的数据隔离。[Storage 访问控制](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/storage/security/access-control.mdx#access-policies)、[现有关系约束](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L54)

登录身份与存储供应商可以独立选择。例如，可继续使用 Google 登录，家谱保存在应用数据库；这种设计不需要申请 Drive 文件权限，但仍需满足所采用登录方式的发布要求。也可以使用邮箱登录，按需让用户连接自己的网盘用于备份。这些是建议架构，尚未实现。

如果用户群体已有 Nextcloud 或其他 WebDAV 服务，可以增加 WebDAV 适配；如果由项目方自行提供 Nextcloud，则服务器容量、运行维护与实例账户管理由项目方承担。网页接入不同实例时，还应验证跨域配置、认证和网络可达性，不能假定所有 WebDAV 地址均可从浏览器直接调用。

**公开接入与成本的核验边界**

- OneDrive 的专属目录能力已核实；其当前公开应用发布者验证和组织准入规则未完整核实，不能承诺比 Google 免审或更容易通过。
- Dropbox 的 SDK 与专属文件夹能力有官方依据；本次未核实当前开发模式用户上限、生产审批门槛及时间，因此不提供具体数字。
- WebDAV 是访问协议，账户属于所连接的服务实例。它不提供统一的公众登录或通用免费存储额度。[Nextcloud 手册](https://github.com/nextcloud/documentation/blob/master/user_manual/files/access_webdav.rst)
- Supabase / Firebase 的功能已核实，但本次未核实价格、免费额度、计费账户要求或地区可达性；不将其描述为无限免费或零运营成本。
- 用户自带网盘会把存储额度主要放在用户账户上；应用提供存储则需要开发者规划容量、请求量、传输、备份与认证邮件等资源。接入第三方网盘也仍可能产生托管和 API 服务成本。这是责任分配建议，不是价格估算。

任何文件存储方案都需要补齐本项目的同步设计。当前自动保存以本进程修订号保护脏状态、整份保存家谱，替换存储供应商不会自动解决两台设备同时修改时的覆盖问题。[现有自动保存](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/autosave.ts#L49)

建议先选择一种主存储，保留本地导入导出，并通过存储接口保留替换余地。第一版同时接入多个网盘会扩大授权、错误恢复和同步验证的范围，这是目前没有必要提前承担的工程成本。

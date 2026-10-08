# Google Drive 配置与使用

Google Drive 是可选存储。用户在网页中授权自己的 Google 账号后，家谱与照片直接从浏览器写入自己的 Drive；应用没有账号数据库、业务后端或中转服务器。本地目录仍可独立使用，不需要任何 Google 配置。

## 部署者需要准备的配置

需要一个 Google Cloud 项目、启用的 Google Drive API，以及 **Web application 类型的 OAuth Client ID**。Client ID 是公开标识，可以出现在网页产物中；不要向网页、仓库或聊天提供 Client Secret、访问令牌或刷新令牌。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目，在 API 库启用 **Google Drive API**。
2. 在 Google Auth Platform 配置应用名称、支持邮箱与开发者联系信息。个人 Google 账号对外使用一般选择 **External** 受众；先在 Testing 状态把实际验收账号加入测试用户。
3. 在 Data Access 中登记 `https://www.googleapis.com/auth/drive.file` 和 `https://www.googleapis.com/auth/drive.readonly`。前者保留应用文件写入能力，后者用于发现和读取当前账号可访问的家谱（含他人共享的项目）。代码在同一次连接中请求两者，不请求完整读写 `drive` 或额外的登录身份 scopes。
4. 创建 **Web application** OAuth 客户端，登记 Authorized JavaScript origins。来源是协议、主机和端口，例如开发时的 `http://localhost:5173`、预览时的 `http://localhost:4173`、正式站点的 `https://family.example.com`。按实际使用地址登记；`localhost` 与 `127.0.0.1` 是不同来源。来源中不要填写 `/family/`、`#/tree` 等路径或 hash。
5. 复制 [.env.example](../.env.example) 为 `.env.local`，配置公开 Client ID：

   ```dotenv
   VITE_GOOGLE_DRIVE_CLIENT_ID=你的客户端编号.apps.googleusercontent.com
   ```

6. 重启开发服务器，或重新执行 `npm run build` 后部署整个 `dist/`。Vite 在构建时注入该值，修改服务器环境变量不会改变已生成的静态网页。

本实现使用 GIS 的浏览器 token 弹窗流程，无后端回调处理程序，不需要为此增加 redirect URI、API Key、Google Picker 或服务账号。浏览器须允许 Google 登录弹窗，并能够访问 Google 登录和 Drive API 服务。嵌入式浏览器、iframe、拦截插件及主机的 CSP/跨窗口隔离策略可能影响授权；验收时先在独立浏览器标签页使用站点。

正式站点使用 HTTPS。静态主机赠送的子域名也能作为技术上的 OAuth 来源，不要求购买域名；但公开发布时的品牌、主页和域名所有权要求仍应按 Google 控制台核对。换站点来源后需要登记新来源；换 Client ID 会改变本应用的连接身份，不能假定已有项目会自动出现在新的 OAuth 应用中。

## 个人使用与公开开放

个人验收可先保留 Testing 并添加自己的账号。Testing 对可用用户、授权持续时间等有限制，以当前 Google 控制台提示为准；本应用只使用短期 access token，不持久化 refresh token，不能把“测试状态下的刷新令牌有效期”当作网页登录会话时长。

向其他用户开放前，应配置发布受众、品牌资料、公开主页、隐私说明与支持联系方式，并处理控制台提出的验证要求。`drive.file` 是非敏感文件范围；本应用同时使用的 `drive.readonly` 属于 restricted scope，需要按 Google 要求处理对应的发布验证。减少写入权限不代表免审核。组织管理员也可能限制第三方应用。普通使用者只需登录和授权，不需要每人申请开发者身份；自行部署者负责其 OAuth 应用配置。

隐私说明应准确交代：选择 Drive 后会上传家谱与处理后的照片；没有应用层加密；项目归用户 Drive 管理；历史版本和照片不自动物理删除。不要把本地目录的“不上传”说明直接用于云端项目。

仓库的 [privacy.html](../public/privacy.html) 是 `family.t-d.fun` 部署的公开隐私政策，构建后位于站点根目录的 `privacy.html`，首页提供入口，阅读本页不需要 JavaScript 或 Google 登录。其他维护者自行部署时，须先核对并修改站点域名、维护者联系方式和日志处理说明，不能直接沿用与其部署不符的声明。Google OAuth 品牌配置中的隐私政策地址应与首页链接一致。

[about.html](../public/about.html) 提供公开的应用介绍，品牌配置的应用首页可指向此页，便于审核工具直接读取应用名称、用途与隐私链接，不依赖 Vue 渲染或 Google 登录。

## 使用流程

1. 在欢迎页加载并连接 Google Drive，完成 Google 授权。
2. 新建项目，或从“可访问的家谱”列表打开已有项目。列表统一显示当前账号可读取、带有本应用标记的项目，包括他人共享的项目；新项目建在“我的云端硬盘”中。任意普通文件夹不会被识别为家谱。
3. 编辑成员和照片。自动保存上传成功后才显示已保存；保存失败仍保留未保存状态。
4. 换设备时，打开配置同一 OAuth 应用的网页，连接同一 Google 账号，再从列表打开项目。页面不会持续拉取远端变化；换设备编辑前先确认原设备已保存。
5. 本地项目可在打开后连同引用照片另存到 Drive；Drive 项目也可另存为新的 Drive 项目。另存产生独立副本，不建立双向同步关系，也不复制原 Drive 的全部历史。另存前可填写家族名称，默认保留原名称，不自动添加“（副本）”；同名项目由不同文件夹 ID 区分。

连接身份由 OAuth Client ID 与 Google `permissionId` 共同确定。最近项目只保存非秘密引用；短期 access token、原到期时间和账号标识由认证模块单独保存在当前站点的 `localStorage`，按 Client ID 隔离。刷新或关闭后重新打开同一浏览器、同一站点时，页面会在有效期内向 Drive 核验账号并恢复连接与项目列表，不弹出 OAuth 窗口；打开最近项目仍需点击。原项目重连时选错 Google 账号会被拒绝，不会把数据写到其他账号。

这不会延长 Google 授予的期限：通常约一小时，以响应中的 `expires_in` 为准，并提前 30 秒停止使用。过期、401、恢复校验失败或主动断开时会清除缓存；未再次打开应用时，过期记录可能仍留在浏览器存储中，但不会被继续使用。浏览器禁止存储时退回仅当前页面连接；清除网站数据、隐私模式结束、换浏览器或换站点后需要重连。

升级共享读取功能后，沿用现有 Client ID 和已登记的 JavaScript origins，在控制台补充 `drive.readonly` 并重新构建部署。只有旧 `drive.file` 的缓存会被清除，用户需点击连接完成双 scope 授权；最近项目引用保留。部分授权不能恢复为完整连接。不使用刷新令牌，不需要新增 Client Secret 或回调地址。站点隐私说明应披露短期连接凭证在浏览器中保存。该存储可被同源脚本访问，不能视为加密保险箱；共用设备使用完后点击“断开连接”。

授权过期或服务返回 401 时，在项目的 Google Drive 保存状态中点击重新连接并保存。自动保存、后台切换和照片请求都不会自行打开 Google 授权窗口。断开应用连接清除本页面凭据及此 OAuth 应用在当前站点保存的短期连接；彻底撤销授权可前往 Google 账号的第三方应用权限页面。

点击家族标题旁的“重命名”可更新名称。Drive 项目会追加保存新名称的版本，并同步文件夹名称；如果名称已保存但文件夹同步失败，对话框会明确提示，可再次点击“保存名称”重试。如果名称版本的上传结果尚未确认，自动保存会暂停并提示先重试重命名，避免只完成一半改名。本地项目更新 `meta.json` 中的名称，本地文件夹名需在文件管理器中另行修改。在 Drive 网页中只改文件夹名不会改动应用内的家族标题。

## 共享与仅查看

由创建者在 Drive 中将整个家谱项目文件夹分享给亲人的 Google 账号。亲人连接同一 Family Tree OAuth 应用后，在同一列表刷新并打开；无需复制文件夹、额外选择“共享项目”入口或把文件设为公开。

打开时读取当前文件夹能力：只有应用已获该文件夹的逐文件授权（`isAppAuthorized`），且可以新增子文件（`canAddChildren`）时启用编辑；重命名还需 `canRename`。单纯共享了编辑权限不一定给应用逐文件写权限，因此某些共享项目仍以“仅查看”打开。没有自动申请完整 `drive`，也不把 `drive.readonly` 当成写权限。真实双账号下的追加版本、照片上传和重命名需按部署验证；组织 Shared drives 的完整兼容未在本轮验收。

仅查看项目仍可阅读成员、关系、照片和历史，不能修改、上传或解决冲突。切换视角保存为按连接及项目隔离的本机偏好，不写回家谱；旧项目的默认视角作为初始值。存储层在保存前再次检查文件夹写能力；权限失效时保留未保存草稿，不能把失败当成已保存；恢复权限后点击重新连接会重新检查能力并重试保存，不会用远端内容覆盖草稿。打开已失效项目、缺失照片和受限导出会报错，不能生成假成功结果。

## 版本与冲突

每次实际提交都会创建一个完整 JSON 快照，记录它基于的父版本；应用不覆盖此前快照。照片与缩略图单独存储，由各个快照引用。

- 打开或保存时检查远端版本图；如果其他设备已提交新版本，停止普通保存，提示用户处理。
- 两个设备近乎同时保存时，可能形成多个分支。它们都会保留，不按最后上传时间自动丢弃其他分支。
- 用户可以查看并打开历史或冲突版本，也可以保留当前页面的内容，再显式确认以其建立后续版本。该操作记录当前观察到的所有分支，不自动合并不同成员的修改；如远端又改变，需要重新检查和确认。
- 打开其他版本会替换当前页面内容。先导出需要保留的未保存草稿；历史版本本身不会因选择或冲突处理而被删除。

这不是实时协作、持续同步或 Drive 原子条件覆盖的实现。网络列表的可见时序可能让并发分支稍后才被发现；追加快照保留各次提交，但不能防止用户从 Drive 手工移动、删除或改写文件。请保留独立备份，不手动编辑内部版本文件或清理旧快照。

## 离线、备份与容量

PWA 的 Service Worker 只缓存静态应用，不缓存 Drive 家谱、照片或令牌；认证模块单独保存上述短期连接，也没有持久化离线上传队列。已打开页面可能还能显示当前数据，但断网后的修改仅在页面内存中；刷新、关闭或系统回收页面可能丢失这些修改。恢复网络后重连并确认保存，再离开页面。

保存状态中的草稿 JSON 下载无需访问云端，可保留当前文字和关系数据，但不含照片内容，只保留照片引用。它是救援材料，不是 `.familybundle`，也没有直接导入草稿的完整恢复向导。

完整 `.familybundle` 导出会读取当前家谱引用的每张主图和缩略图；缺少网络、授权或照片时会失败，不生成“完整备份成功”的假象。支持 `showSaveFilePicker` 的浏览器使用文件流导出；其余浏览器准备最多 **128 MiB** 的内存归档，完成后提供真实下载链接，需要用户点击。较大项目应在支持文件流保存的桌面浏览器导出。

当前 `.familybundle` 导入目标仍是用户授权的本地空目录。没有目录 API 的手机浏览器可以使用 Drive 和导出备份，但不能直接把 `.familybundle` 导入 Drive；可以先在支持目录 API 的桌面浏览器导入，再打开项目并另存到 Drive。

Drive 版不自动清理历史、删除云端照片或提供媒体 GC。移除成员照片只改变当前家谱引用，历史仍可读到原照片；取消上传等失败操作也可能留下未引用媒体。每次保存追加完整 JSON、照片上传生成主图和缩略图，存储占用及列举历史的 API 请求成本会随使用增长，受账号容量、API 配额和网络限制。当前没有历史压缩功能，适合先用代表性项目验收，再评估长期规模。

要彻底移除云端项目，需在 Drive 中处理整个项目文件夹及其回收站内容；另行处理导出备份和其他独立副本。不要只删除某个历史文件，这会破坏版本图。

## 验收边界与排错

自动化使用虚构数据和替身 GIS/Drive REST 验证流程，不登录真实 Google 账号。真实 OAuth、Google 侧权限策略、目标手机浏览器、实际 Drive 容量和请求配额必须在配置 Client ID 后验收；Chromium 自动化通过不等于 iOS Safari 已验证。

| 现象 | 检查项 |
| --- | --- |
| Drive 入口提示未配置 | `.env.local` 中的公开 Client ID、重启或重新构建是否生效 |
| `origin_mismatch` / 来源不允许 | 当前完整来源是否与 Authorized JavaScript origins 一致；路径不属于来源 |
| 测试账号无法授权 | External/Testing 测试用户、Drive API 是否启用、组织管理员限制 |
| 登录窗口打不开 | 独立标签页、允许弹窗、网络、拦截插件与主机安全响应头 |
| 找不到原有或共享项目 | 同一 OAuth 应用、连接账号是否为被分享的账号、是否完成双 scope 授权；刷新列表；确认整个项目文件夹已共享且未删除 |
| 保存失败或提示冲突 | 保留页面，必要时下载草稿；检查网络/授权，再查看历史并显式处理 |
| 照片被移除但容量未下降 | 历史照片按设计保留，当前没有自动 GC |

共享读取与写入的双账号验收步骤见 [共享项目访问验证](google-drive-sharing-verification.md)。

首次真实验收至少包括授权取消/撤销/过期、同账号跨设备项目列表、错账号重连、照片读写、双设备冲突、网络中断后重试，以及备份下载与恢复。操作细节和实际权限提示以当前 Google 控制台为准。

## 参考

- [Google 官方浏览器 Drive 示例](https://github.com/googleworkspace/browser-samples/blob/main/drive/quickstart/index.html)与[来源配置说明](https://github.com/googleworkspace/browser-samples/blob/main/README.md)。
- [Drive v3 官方接口定义](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json)：`drive.file`、账号 `permissionId`、文件 ID 与 `appProperties`。
- [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)、[Drive scope 与验证分类](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[生产环境政策](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)。
- [统一存储接口](storage.md)、[项目格式](project-format.md)、[历史调研及其证据边界](research/public-web-google-drive.md)。

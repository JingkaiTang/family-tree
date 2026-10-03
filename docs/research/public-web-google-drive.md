# 家族树对外开放与 Google Drive 存储调研

> 历史调研：正文记录实现前的候选方案与当时代码，不代表当前功能。项目现已仅保留 Web/PWA，已实现浏览器普通目录、图片处理和备份；原生工程已移除，Google Drive 适配已接入，配置与限制见 [Google Drive](../google-drive.md)。当前支持范围以 [Web 部署说明](../web-deployment.md) 为准，架构与 IO 见 [架构说明](../architecture.md) 和 [存储接口](../storage.md)。

调研日期：2026-10-03。代码基线：`c33861279d48b93c33b00d2ea92e8d66407e8c23`。本次检查代码、项目文档及公开的一方资料；未改动业务代码，未部署服务，未读取真实家谱或照片，未操作 Google 账户。

后续已明确纯前端分发、无应用账号、普通本地目录优先的目标，当前方向见[纯前端与用户自带存储方案](static-frontend-user-storage.md)和[本地目录与 Drive 对比](local-directory-vs-google-drive.md)。下文是前期以 Drive 为重点的调研，涉及认证后端或业务数据库的内容保留作方案比较，不代表当前默认架构。

**建议结论**

建议先做响应式网页/PWA，让每位用户管理自己的家谱并在自己的设备间同步，数据保存在该用户的 Google Drive。保留现有 Tauri 桌面版本和核心领域逻辑，将主要改造集中在存储接口、同步可靠性、照片处理与手机交互。Google 登录只是其中一项新增能力。

这是基于当前代码的工程建议，而不是已经确认的产品范围。如果第一版要求家人共同编辑同一份家谱，应优先重新评估服务端权限与并发写入模型。当前尚未确认协作需求，因此下文同时保留三条路线。

| 对外开放的目标 | 建议路线 | 相对投入及边界 |
| --- | --- | --- |
| 每人自己的家谱，电脑和手机同步 | 网页/PWA + 用户 Drive + 本地缓存 | 最贴近现有文件模型；仍需处理同一账号多设备冲突 |
| 一人维护，亲人只读查看 | 上述方案 + 明确的分享与读取权限 | 增加邀请或文件授权、撤回访问、只读交互；分享文件不自动完成应用内权限设计 |
| 家人共同编辑 | 网页/PWA + 服务端账户、家谱权限、写入协调；优先评估数据库作为主存储 | 需保证关系图一致性、权限检查和冲突处理；Drive 可作为附件、导出或备份层 |

第三条并非技术上禁止使用 Drive，而是当前全量 JSON 写入方式与多人协作不匹配。关系修改涉及反向引用、配偶约束和祖先环检查，不能把不同人的成员字段直接合并后视为正确。[项目格式](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L54)、[保存代码](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/tauriApi.ts#L23)

**已从项目核实的现状**

| 现状与依据 | 对公开网页版的影响 |
| --- | --- |
| Vue、Pinia、亲属称谓和布局已有清晰分层；领域核心不依赖 Tauri，布局已有浏览器 Web Worker。[架构](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/architecture.md#L27) | 可以复用家谱领域模型、关系校验、称谓计算和布局；无需重写整套应用 |
| 新建、打开、保存、照片读取与目录选择都通过 Tauri IPC 或 dialog。[tauriApi](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/tauriApi.ts#L1) | 直接把当前 `dist` 放上云，不能使这些功能在普通浏览器中工作 |
| `projectService` 负责迁移、Zod 和关系图校验，但直接导入 `tauriApi`。[projectService](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/projectService.ts#L10) | 是适合抽出存储边界的入口；照片组件和页面的直接依赖也要一起改 |
| 项目由 `meta.json`、`family.json`、照片和缩略图组成，目前格式版本为 4。[项目格式](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L5) | 与文件型云存储相容，可保留领域 JSON，将远端文件映射和同步信息单独设计 |
| 项目标识是本机 `projectPath`；最近打开项目是单个 localStorage 路径。[store](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/stores/family.ts#L38)、[prefs](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/prefs.ts#L9) | 云版需要稳定项目 ID、Drive 文件 ID，以及按登录账号隔离的缓存和最近项目 |
| 自动保存捕获整份家谱，依靠当前进程的 `revision` 与 `projectToken` 清除脏状态；打开项目时 revision 归零。[autosave](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/autosave.ts#L49)、[store](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/stores/family.ts#L53) | 当前机制防止旧保存结果清除新修订或新项目会话的脏状态，但不提供跨设备版本协调 |
| Rust 保存轮转三份备份，并原子写入整份 JSON。[Rust 保存](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src-tauri/src/commands/project.rs#L268) | 云端必须重新实现保存和恢复语义；不能认为 Drive 上传天然继承本地原子写入与备份保证 |
| 图片解码、尺寸限制、缩放和两份 WebP 生成在 Rust。[媒体代码](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src-tauri/src/commands/media.rs#L79) | 网页版需补浏览器图片处理或服务端图片处理，现有上传和裁剪 UI 可以继续使用 |
| 关闭浏览器时调用异步 `flushNow`，未等待其完成。[autosave](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/autosave.ts#L139) | 需要尽早落入本地持久化队列，不能把关页时上传当作可靠保存方案 |
| 成员页面固定左右两栏，右侧使用 `w-96`；工具栏较长，已有 Pointer Events 不等于完成手机适配。[成员页](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/pages/MemberDetail.vue#L153)、[树页面](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/pages/TreeView.vue#L197)、[节点](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/components/tree/MemberNode.vue#L134) | 手机需要折叠菜单、纵向表单/页签，以及明确区分查看、平移和编辑拖动 |
| 当前视角 `defaultViewpointId` 会写入项目的 `family.json`。[store](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/stores/family.ts#L328) | 若引入共享，应将个人视角与家谱事实分开，避免亲人相互覆盖自己的浏览偏好 |

检查 `package.json`、路由、服务和平台配置，未发现 Google OAuth、Drive 客户端、服务端账户系统、IndexedDB 同步队列或 PWA manifest/service worker 的现有实现；这些属于新增工作。[依赖](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/package.json#L1)、[路由](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/router/index.ts#L1)、[构建配置](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/vite.config.ts#L1)

**Google 技术接入的已核实事实**

以下 Google 技术事实来自实际读取的官方 GitHub SDK、接口定义及示例。接口定义标注 revision 为 `20260916`；这些资料不替代 Google Auth Platform 的审核结果。

1. **Drive 权限有不同范围。** 官方 Discovery 将 `drive.file` 描述为 “only the specific Google Drive files you use with this app”，将 `drive.appdata` 描述为 “its own configuration data in your Google Drive”。本项目建议优先用 `drive.file` 创建和访问应用自己的家谱文件；不要为此默认申请整个 Drive 的读写权限。[官方定义](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json#L5)
2. **Drive 的分享操作有独立权限要求。** `permissions.create` 支持 `drive` 和 `drive.file`，不接受仅有 `drive.appdata` 的授权。因此，不应把仅申请 appdata 的方案当作现成的家族分享机制。这一结论不扩展为本轮未直接核实的 appDataFolder 全部限制。[官方定义](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json#L2170)
3. **纯浏览器访问 Drive 有官方路径。** 官方示例使用 `google.accounts.oauth2.initTokenClient` 和 `requestAccessToken` 获取 access token，再调用 Drive；示例未实现 refresh token 持久化。其示例 scope 是只读元数据，不能直接照搬为本项目的写入权限。[官方浏览器示例](https://github.com/googleworkspace/browser-samples/blob/main/drive/quickstart/index.html#L77)
4. **服务端可使用授权码和离线授权。** 官方认证库展示 `generateAuthUrl({ access_type: 'offline', ... })`、`getToken(code)` 及 refresh token 自动续期。若选用这一方案，建议后台安全保存刷新令牌，前端不放 client secret，不把 token 写入日志。[官方认证库](https://github.com/googleapis/google-cloud-node-core/blob/main/packages/google-auth-library-nodejs/README.md#L143)
5. **测试模式不适合长期 Drive 授权。** 官方 SDK README 明确列出 External + Testing 会导致刷新令牌 7 天后失效；撤销授权等也会使令牌失效。正式版需要正确处理发布状态、续期失败和重新授权，不能承诺切到 Production 后令牌永不失效。此处结论限定于包含 Drive 权限的方案，不泛化为所有 Google 登录。[官方 SDK 说明](https://github.com/googleapis/google-api-nodejs-client/blob/main/README.md#L253)
6. **文件版本可用来观察远端变化，但不是自动获得的并发锁。** Discovery 将 `File.version` 定义为只读、单调递增的服务端文件版本。本次没有验证一个可直接依赖的原子条件覆盖协议；不能把“先 GET 版本、后上传”当作无竞争的写入。[官方 File 定义](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json)

Google Workspace 官方组织的一份示例 README 把 `drive.file` 标为 “Recommended / Non-Sensitive”，但该项目同时注明不是正式支持的 Google 产品；这属于辅助依据，不能据此保证本应用完全免审核。[辅助资料](https://github.com/googleworkspace/redriveapp/blob/main/README.md#L8)

如果后续加入亲人分享，需单独验证受邀用户在 `drive.file` 下能否通过应用打开家谱及其照片，分别核对文件分享权限与应用获得的 OAuth 授权；不能只完成目录分享就假定整套项目读取流程已经可用。

**建议的第一版结构**

建议保留同一套 Vue 和领域代码，分离平台读写能力：桌面端继续用 Tauri；网页端用浏览器本地缓存与 Drive 同步。不要将现有 Rust 本地文件命令直接搬到共享服务器，继续接收客户端提供的本机路径。

```text
电脑浏览器 / 手机浏览器或 PWA
              │
       Vue + Pinia + 家谱领域核心
              │
       项目与媒体存储接口
          ┌───┴────────────┐
          │               │
   浏览器本地缓存       Tauri 本地文件
   与待同步队列         （保留桌面版）
          │
      Drive 同步模块
          │
   当前用户的 Google Drive

登录身份与 Drive 授权分别处理；可按体验需要增加小型认证后端。
```

建议的项目存储设计如下。这些是拟议设计，尚未实现或进行多设备验证。

- 用户 Drive 中由应用创建项目目录，以稳定 ID 识别，不依赖可重名、可改名的目录名称；保存家谱 JSON、照片及缩略图，维护 `photoId → Drive fileId` 映射。Drive 的文件 ID、父目录和私有 `appProperties` 字段可作为实现基础。[接口定义](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json)
- 同步元数据应与现有 schema v4 领域事实分开；云端协议版本、账号、项目、基准版本及媒体状态由存储层管理。`memberId` 代表家谱人物，不等于 Google 登录用户。[现有模型](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/core/schema.ts#L28)
- 本地先保存，随后上传；分别显示“本机已保存”“同步中”“已同步”“需要处理冲突”。本地缓存、待上传队列和账号身份绑定，切换账号时不能把上一账号的队列传到新账号。
- 媒体成功上传后再提交引用它的家谱版本；上传失败、重复重试或中途断网时保持可恢复。家谱快照与关联媒体应能一起导出，手机端不能只依赖选择文件夹。
- 第一版发生冲突时保留两个版本，由用户选择或恢复；暂不自动合并关系图。可以验证不可变快照、服务端串行提交或经文档证实的条件写入方案，具体协议需在实现前选定并做双设备实验。
- 首版暂停云端自动媒体清理。现有 GC 按当前本地快照判断引用，不能直接用于云端；后续应依据已提交远端版本并设置恢复宽限期。[当前 GC](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/pages/TreeView.vue#L118)、[Rust GC](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src-tauri/src/commands/media.rs#L143)

**是否需要自己的后端**

| 方案 | 适用范围 | 需要承担的工作 |
| --- | --- | --- |
| 静态网页/PWA + 浏览器授权 + 直接访问 Drive | 首批验证；用户打开页面时同步 | 令牌失效后的重新授权、断网队列、跨设备冲突；不承诺关页后继续同步 |
| 网页/PWA + 小型认证/API 后端 + 用户 Drive | 需要服务端续期、账户会话或处理已提交后台任务的正式产品 | 安全保存刷新令牌、会话管理、逐用户授权和 API 请求隔离；不必因此把家谱主数据迁入业务数据库 |
| 网页/PWA + 业务后端与数据库 | 多人共编、角色权限、集中检索和协作历史 | 服务器端权限和关系一致性、事务/冲突策略、数据迁移与运维 |

第一条和第二条均有官方授权示例支持，上表的产品选择是工程判断。[浏览器示例](https://github.com/googleworkspace/browser-samples/blob/main/drive/quickstart/index.html#L77)、[服务端示例](https://github.com/googleapis/google-cloud-node-core/blob/main/packages/google-auth-library-nodejs/README.md#L143)

建议第一轮先验证纯浏览器方案的授权与重新授权体验，再决定是否增加小型后端。若用后端代理 Drive，家谱内容可能流经服务器，不能宣传为“服务器完全接触不到数据”；后端也无法在浏览器关闭后上传尚未从设备发送的修改。

**移动端与数据可靠性**

PWA 能减少单独维护原生移动 App 的需求，但安装能力、离线使用和同步是不同工作。MDN 文档说明 manifest、HTTPS 与安装体验的关系，并明确 service worker 常用于离线体验，不能把“可以安装”当作“自动离线同步”。[MDN 一方源码](https://github.com/mdn/content/blob/main/files/en-us/web/progressive_web_apps/guides/making_pwas_installable/index.md)

MDN 明确指出 `beforeunload` 在移动端可能完全不触发；浏览器的 IndexedDB/Cache 默认也可能被回收。因此建议编辑后及时写本地队列，成功同步到 Drive 后再显示已同步，并提供导出和恢复；申请持久存储也不替代云端同步和用户备份。[beforeunload](https://github.com/mdn/content/blob/main/files/en-us/web/api/window/beforeunload_event/index.md)、[存储回收](https://github.com/mdn/content/blob/main/files/en-us/web/api/storage_api/storage_quotas_and_eviction_criteria/index.md)

手机适配建议先覆盖成员表单、关系编辑、树形浏览、照片导入与冲突处理；验收需包含 Android Chrome、iOS Safari 和桌面浏览器。现有 500 人性能检查可作为算法基线，但不能替代手机实机体验验证。[项目测试边界](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/architecture.md#L80)

**对公众发布的准备路径**

以下是拟议操作顺序。本轮没有访问或修改任何 Google Cloud 项目；Google 审核政策页面受环境网络规则限制，未能实时读取。因此这里将“应准备的材料”与“本次已核实的 SDK 行为”分开，不把清单描述成已经确认的完整强制要求。

1. 确认第一版是个人家谱同步还是家族协作，以及目标用户实际能否使用 Google 服务。选择稳定 HTTPS 域名和网页托管；是否需要额外认证服务按前述体验实验决定。
2. 在 Google Cloud / Google Auth Platform 配置对外受众、应用品牌和 Web OAuth 客户端，启用 Drive API。拟定权限为基本身份信息加独立请求的 `drive.file`；配置实际网站来源和需要的回调地址。具体字段与约束以上线时控制台及官方政策为准。
3. 用独立测试配置和虚构家谱跑通授权、拒绝、撤回、重新授权、换账号与电脑手机同步；含 Drive 的长期方案不能停在 External / Testing，7 天刷新令牌限制已有官方 SDK 依据。
4. 准备公开主页、隐私政策、支持联系渠道、授权用途说明和必要的域名所有权资料。服务条款、品牌审核、敏感/受限权限验证是否适用，应在实际 scopes 和品牌配置下逐项核对；“非敏感”不等于所有验证都自动豁免。
5. 明确用户可执行的操作：导出家谱、删除应用数据、断开 Drive、退出与清理本地缓存。断开授权不应被当成已经删除文件，未同步修改也不应在退出时被静默丢弃。这是本产品的设计建议。
6. 通过下列验收后再开启小规模公开测试；稳定后扩大访问。生产发布状态与 Google 验证状态分别检查，不将其中一个替代另一个。

本项目保存照片、生日、居住地及家庭关系，当前 README 和格式文档承诺本地存储、不主动上传。云版必须准确说明上传时机、存储位置、服务器是否接触数据，以及删除/导出的实际行为；不能继续照搬桌面版的本地存储文案。这是现有功能直接带来的产品要求。[成员字段](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/core/schema.ts#L28)、[当前隐私说明](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L92)

上线前需重新打开并核对的官方入口如下，**本轮未成功读取这些页面**，不得视为已完成政策核验：

- [生产环境政策合规](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [品牌验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Drive scopes 和验证分类](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [appDataFolder 行为和限制](https://developers.google.com/workspace/drive/api/guides/appdata)
- [浏览器 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [授权码 code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)

不对审核通过、审核时长、精确用户额度或托管价格作承诺；本次没有获取对应控制台状态或价格表。

**建议实施顺序与验收结果**

| 阶段 | 主要工作 | 完成后应能证明 |
| --- | --- | --- |
| 1 浏览器本地闭环 | 抽出项目/媒体存储接口，保留 Tauri；增加浏览器缓存、照片处理与归档导入导出 | 普通浏览器能创建、编辑、刷新恢复和导出虚构家谱，照片不丢失 |
| 2 Google 与 Drive 闭环 | 登录与 Drive 授权、项目列表、账号隔离、上传队列和冲突恢复 | 电脑保存后手机能打开相同数据；拒绝授权、断网或换账号不会串数据或覆盖未同步修改 |
| 3 手机与公开测试 | 响应式页面、PWA、持久化/同步状态、隐私与支持页面，完成适用的 Google 发布验证 | 手机上可完成核心操作，退出/重开/撤销授权后的状态明确且能恢复 |
| 4 按需求引入协作 | 邀请、只读/编辑权限、个人视角隔离、服务端写入协调 | 两人同时修改时保持关系图有效；撤销后在线新请求不再获得授权，并说明已下载或离线副本不会随之消失 |

阶段 2 必须专门验证：两台设备从同一旧版本各自修改；一端离线后另一端修改；照片已上传但家谱提交失败；Drive 空间不足或文件被用户删除；切换账号时仍有待上传内容。预期结果是保留可恢复版本、清楚显示状态，不能静默丢弃另一端的数据。这些是后续实现的验收用例，本次没有运行。

工作量判断：静态托管配置和登录按钮属于局部工作；存储替换、媒体处理及可靠同步是主要改造；多人协作再增加一层数据与权限设计。本次研究不提供未经实现验证的工期估算。

**本次验证边界**

已完成仓库只读审查、官方 GitHub SDK/接口/示例及 MDN 原始文档读取，并检查本调研文档的本地链接。未进行 OAuth 实际登录、Drive 读写、浏览器实机测试或云端部署；未运行业务测试，因为本次仅新增调研文档。Google 政策网页经正常代理返回 CONNECT 403，已停止该路径访问，政策核验保留为上线前待办。

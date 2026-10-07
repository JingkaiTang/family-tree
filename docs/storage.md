# 项目与媒体存储接口

## 当前实现

桌面和移动设备共享 Web UI、领域逻辑和项目格式，业务代码通过 `src/services/storage` 读写项目和照片。Web/PWA 是唯一分发形式，支持普通目录与 Google Drive；上层共享家谱校验、自动保存和照片接口。

| 提供商 | 位置与运行环境 |
| --- | --- |
| `browser-directory` | 支持目录 API 的浏览器中，用户选择并授权的普通目录 |
| `google-drive:<clientId>:<permissionId>` | 配置 Web OAuth Client ID 后，由用户登录并授权的 Google Drive；两段身份分别编码 |

本地目录只使用普通目录 API，不运行 OPFS 项目存储；Drive 不依赖该 API。支持范围见 [Web 部署](web-deployment.md)，OAuth 配置、跨设备使用与限制见 [Google Drive](google-drive.md)。

```text
页面 / 组件 / 自动保存
         │
projectService：家谱格式迁移、schema 与关系图校验
         │                 照片调用
         └──────────┬──────────┘
          services/storage 公共入口
                    │ 按 ProjectRef.providerId 路由
          ProjectStorageProvider
              ┌─────┴──────┐
     browser-directory   google-drive（按 OAuth 应用与账号隔离）
              │            │
       浏览器目录句柄    Drive REST + 追加版本
              │            │
         用户普通目录    用户 Google Drive
```

这是一组项目与媒体 IO 接口。文件路径、浏览器目录句柄、云盘文件 ID 留在各自实现中；不要求所有存储都支持普通文件系统的 rename、目录锁或事务。

## 项目引用与接口

完整类型见 [types.ts](../src/services/storage/types.ts)。

```ts
interface ProjectRef {
  readonly providerId: string
  readonly id: string
  readonly displayName: string
}
```

`id` 在业务代码中是不透明值；只有提供商解释它。浏览器目录使用 IndexedDB 句柄记录的 ID；Drive 使用项目文件夹 ID。`displayName` 只用于展示，不用于查找项目。

一个提供商实例绑定一个连接。Drive 的 `providerId` 由 OAuth Client ID 与 Google `permissionId` 组成，重连必须核对账号；不能在同一标识下静默换账号。应用不在项目引用或最近项目记录里保存令牌、密钥、原始句柄或照片。

| 提供商方法 | 契约 |
| --- | --- |
| `createProject(targetId, name)` | 在指定位置创建项目结构和元数据；返回实际项目 ID，可与创建目标不同。公共项目模块随后向新项目写入初始家谱 |
| `loadProject(projectId)` | 返回项目标识、显示名称和未经校验的 `unknown` 数据；由 `projectService` 迁移、校验 |
| `saveProject(projectId, family)` | 成功表示该实现已经完成持久化；失败必须拒绝 Promise，不能只入内存队列就报告成功 |
| `importPhoto(projectId, bytes, mime)` | 按项目媒体格式持久化主图和缩略图，返回可引用的 `photoId` |
| `readPhoto(projectId, photoId, thumb)` | 返回 Blob，不要求照片公开可访问，不把授权信息暴露给图片组件 |
| `deletePhoto(projectId, photoId)` | 按提供商策略处理媒体；浏览器先复制到 `.trash` 再删除，Drive 为保留历史而不物理删除 |
| `gcMedia?(projectId, usedIds)` | 可选能力；只有能安全清理时才实现，界面通过 `supportsMediaGc(ref)` 检查 |

公共入口的每次操作都接受完整 `ProjectRef`，因此相同 ID 在不同提供商之间不会混用。没有全局“当前存储”的隐式路由；未知提供商明确报错，不回退到本地。

项目选择器 `ProjectPicker` 与 IO 分开：只有用户新建/打开时触发选择或授权。`create` 模式返回创建位置，`open` 返回已有项目；取消返回 `null`。可选 `authorizeProject(id)` 仅由用户点击发起重新授权，读取和自动保存不得自行弹出授权窗口。Drive 的项目列表和连接由 `googleDriveConnection.ts` 编排，账号连接后注册提供商；通用 `authorizeProject` 只在用户操作中进入重连流程。

## 已接入的业务链路

- `projectService` 负责创建、迁移、校验和保存；创建后的初始家谱保存到提供商返回的新项目引用。
- Store 和自动保存快照持有完整引用。切换项目后，旧保存结果仍必须通过 `projectToken` 与 `revision` 校验才可清除脏状态。
- 图片读取统一创建 Blob URL，组件在替换、丢弃过期结果与卸载时释放它。异步导入结果也检查项目会话，避免赋给另一个项目。
- 最近项目在 `family-tree:lastProjectRef` 保存三个引用字段，Drive 引用保留账号/应用标识但不保留令牌，有效的短期连接可在启动时核验恢复，否则须显式连接对应账号；目录访问依赖浏览器授权句柄，旧版本的绝对路径或托管 ID 无法直接获得网页权限，需要重新选择目录或导入备份。自动恢复失败保留记录供重试；手动忘记或关闭项目清除记录，避免返回欢迎页时自动重开。
- 移动端后台/页面隐藏时仍立即刷新同一保存队列；聚焦纵流和网格图片均使用统一接口。
- `.family` 与 `.familybundle` 数据格式保持兼容；存储提供商的移除不会改写家谱 schema。

## 浏览器目录与可靠性

- 选择器直接在点击中调用 `showDirectoryPicker({ mode: 'readwrite' })`。IndexedDB 仅保存目录句柄与不透明 ID；项目、照片和备份写在普通目录，不受站点数据库配额限制。
- 恢复句柄后查询权限；失效时保留最近项目记录，等待用户重新授权或选择原目录。清除站点数据只丢失记录和缓存，不删除普通目录文件。
- 新建和备份导入要求空目录。普通打开验证项目标记、大小、schema 与关系图；不存在或不可访问的目录明确报错。
- 保存保留三份 `family.json.bak.N`，通过 `createWritable()` 写入并等待 `close()` 提交；失败时中止流。浏览器不依赖外部目录 rename，也不声称 `meta.json`、家谱和照片共同提交为事务。
- 同来源窗口通过 Web Locks 串行执行目录操作，同一目录复用句柄 ID。保存比较已加载的 `family.json` 内容与当前磁盘内容，变化时拒绝覆盖。其他来源或外部编辑器不参与该锁；检查到提交之间仍存在跨程序竞争窗口。
- PNG/JPEG/WebP 在解码前检查格式、25 MiB 和 4000 万像素限制，再生成最长边 1600px 主图与 256px 缩略图。只保存有效 WebP，图片内容通过 Blob 按需读取。
- 删除照片先复制主图和缩略图到 `.trash`，两份回收副本就绪后再删除原文件；浏览器适配器暂不实现 `gcMedia`。

`projectTransfer.ts` 编排跨提供商的备份导出，使用兼容既有备份的 `archiveVersion=1` ZIP。导出逐张读取项目引用的照片；有 `showSaveFilePicker` 时流式写文件，没有时生成最多 128 MiB 的 Blob 并提供用户点击的下载链接。导入先选择文件、再点击选择空目录，按条目有界解压，完整读取媒体后才写项目标记。异常时仅清理本次创建且未被外部改变的文件，不递归删除目标目录。浏览器导入不是目录级原子 rename；恢复与限制见 [项目格式](project-format.md)。

## Google Drive 与可靠性

- `googleDriveClient.ts` 封装 GIS token 授权与 Drive v3 REST；只申请 `drive.file`，通过 `about.get` 的 `permissionId` 确认账号。Access token 与原到期时间、账号标识由认证模块单独写入按 Client ID 隔离的 localStorage；启动时通过 Drive 核验账号后恢复，过期/401/断开时清除，存储不可用时退回仅内存连接。过期后由用户点击重连；无 Client Secret、刷新令牌或后台授权弹窗。
- `googleDriveConnection.ts` 将连接状态、账号隔离、项目列表和版本操作接入 UI。REST 客户端校验响应与大小，处理分页、超时和有限重试；上传使用预生成文件 ID，遇到结果不确定时检查同一 ID 的内容，避免盲目追加重复文件。
- 超过 5 MiB 的文件使用 resumable 上传，每片最多 1 MiB；响应丢失时先查询进度再续传。有进展不会消耗连续失败预算，连续八次失败或无进展会停止，并保留待保存状态。
- `googleDrive.ts` 使用本应用的 `appProperties` 标记识别项目、快照和照片，不按可重名的文件名识别。项目只列出本 OAuth 应用可访问的项目文件夹，不提供全盘 Picker 或亲友共享流程。
- 每次保存追加完整 JSON 快照和父版本引用，不修改旧快照。保存前检查当前分支，提交后再次观察；其他设备并发产生的分支保留到显式解决。历史/冲突操作通过 Drive 专属接口提供，统一 IO 不添加虚假的条件覆盖能力。
- 解决冲突要求用户选择要保留的内容，并确认当时观察到的全部分支；新快照以这些分支为父版本，旧版本继续保留。远端再次变化会拒绝旧确认，不自动合并内容，也不声称列表检查是跨设备原子锁。
- 照片复用浏览器输入校验、WebP 主图/缩略图处理，私有图片经授权读成 Blob。`deletePhoto` 不物理删除云端媒体，且不实现 `gcMedia`，防止破坏历史引用；不清理历史和失败上传残留。
- 每次全量 JSON 版本与媒体长期保留，会增加容量及请求消耗；没有持续拉取、持久化离线上传队列或历史压缩。PWA 不缓存 Drive 数据，断网未保存内容仅在页面内存中。

完整备份必须能读取所有被引用的照片，否则导出失败。草稿 JSON 不访问远端、不含照片，供网络或授权故障时救援，不能替代完整备份。已打开项目可以通过统一媒体 IO 复制到新的 Drive 项目；副本不继承旧项目历史，也不建立同步。备份导入仍要求本地空目录。

## 增加提供商

1. 实现 `ProjectStorageProvider`，明确连接身份、持久化完成语义、媒体处理和错误行为。
2. 如需交互选择项目，实现独立 `ProjectPicker`；授权的发起和续期体验属于该提供商的接入流程。
3. 在 [装配入口](../src/services/storage/index.ts) 注册实例及选择器。业务模块继续调用同一公共接口；同一运行环境提供多个可选存储连接时，需补充提供商选择界面。
4. 使用公共接口验证创建、打开、保存、照片读写、故障恢复，以及不同连接拥有相同项目 ID 时的隔离。

其他云盘适配需要明确部署配置、授权续期、连接身份、重试与并发写入语义，不能仅凭换一个 `providerId` 就得到同步。领域代码继续使用当前接口，图片处理及归档格式可以复用；具体认证与文件 ID 留在适配器中。

存储抽象本身不提供跨设备同步或全项目事务。当前接口没有假的条件写入参数；Drive 使用追加式版本图，并通过保存契约、会话状态和双设备冲突测试共同约束。远端提供商在没有安全清理协议前，应省略 `gcMedia`。

## 验证

`storage/storage.test.ts` 使用非路径 ID 的两个测试内存提供商验证项目与媒体隔离、创建位置、取消选择、缺失能力、未知提供商和持久化完成语义；它不是可供用户选择的正式存储。

Drive 客户端/适配器测试覆盖授权、账号隔离、版本分支和网络失败；浏览器 Drive 流程使用 GIS 与 REST 替身，不代表真实 OAuth 已验收。项目格式、自动保存、偏好恢复和相关组件的回归测试共同覆盖业务接入；这些测试不替代桌面或手机真机端到端验收。

浏览器适配器、图片处理和归档模块另有错误与恢复测试。`npm run test:e2e` 在真实 Chromium 中验证网页流程，使用 OPFS 句柄替代系统选择器；这是测试装置，不是运行时降级实现，也不等于系统目录授权或 Android 真机已经验收。

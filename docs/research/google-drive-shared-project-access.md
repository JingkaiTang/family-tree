# Google Drive 共享家谱访问实践

## 结论

针对同一 Family Tree 应用创建、通过 Drive 分享给另一账号的家谱，优先采用 `drive.readonly + drive.file` 来统一发现和读取有一手实践依据：rclone 官方支持该组合，Google 自己的 Workspace MCP Codelab 也配置该组合。它们证明这是一种实际使用的授权方案，不能据此认定所有共享写入都能成功。[rclone scopes](https://rclone.org/drive/#scopes) · [Google Codelab 的 Google Drive 配置](https://codelabs.developers.google.com/google-workspace-ge?hl=en#3)

用户已确认接收方能在 Drive 网页打开文件夹、但 Family Tree 列表看不到。本次研究无需获得用户的私人链接或访问令牌。以下建议依据官方文档、项目方源码与本仓库代码；尚未对 Family Tree 的真实双账号授权完成验收。

## 已核实的实践

### rclone 支持广泛读取和应用文件写入的组合

rclone 官方文档 Scopes 段明确允许组合 scope，示例就是 `drive.readonly,drive.file`。同节分别解释只读范围可列出和下载文件，以及 `drive.file` 的受限文件访问行为。这支持 Family Tree 用读取权限解决发现和内容读取问题，同时保留现有应用文件写入能力；不能把组合解释成对所有可读文件都有修改权限。[官方说明](https://rclone.org/drive/#scopes)

rclone 的共享目录逻辑还揭示一个查询细节：定位 Shared with me 入口时不应同时限定个人根目录；进入已知共享文件夹后使用父目录 ID 查询，不继续限定 `sharedWithMe`。该逻辑走共同的列表函数。[官方源码 drive.go 的共享目录查询](https://github.com/rclone/rclone/blob/master/backend/drive/drive.go#L972-L995)

对 Family Tree 的启发是，在内部统一处理项目发现与读取，不需要给用户增加另一种项目类型。rclone 的特殊根目录查询不能机械照搬到本项目：Family Tree 已经按应用标记搜索，并未限定个人根目录。[当前项目查询](../../src/services/storage/googleDrive.ts#L89-L93)

### Google 自己的连接器示例采用相同组合

Google 的 Google Workspace MCP server connectors in Gemini Enterprise apps 教程，在 OAuth Data Access 及 Google Drive 连接器配置中都明确使用 `drive.readonly` 与 `drive.file`。这是第一方配置实践，并非社区猜测。[OAuth 配置](https://codelabs.developers.google.com/google-workspace-ge?hl=en#2) · [Google Drive 连接器配置](https://codelabs.developers.google.com/google-workspace-ge?hl=en#3)

这个例子的架构是连接器，不是 Family Tree 的纯浏览器应用；可参考其权限组合，不能照搬 Client Secret、回调或后端部署方式，也不能把它视为共享家谱的写入验证。

### draw.io 采用逐文件授权入口

draw.io 的公开编辑器源码请求 `drive.file`、`drive.install` 和用户资料 scope，并使用 Google Picker，传入当前 token 和应用 ID，让用户选择要打开的文件。[源码的 scopes](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/DriveClient.js#L72-L74) · [文件 Picker](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/DriveClient.js#L2570-L2608)

draw.io 关于链接查看的官方说明则指出，非公开图表的查看需要登录并授权广泛读取。这个说明针对该产品的链接查看流程，不能推广为所有 Drive 应用的要求。[官方 Permissions 说明](https://www.drawio.com/docs/integrations/google/share-diagrams-via-google/#permissions)

对 Family Tree 而言，Picker 是有成熟实践的替代路线，但用户希望连接后直接出现家谱列表；优先采用读取 scope 更符合这一目标。Family Tree 还有独立的历史文件与照片，不能从单个图表文件的 Picker 实践推断整个家谱目录的内容都会获得授权。[Family Tree Drive 文件布局](../project-format.md#google-drive-版本格式)

## Google 官方权限边界

`drive.file` 是逐文件访问范围；`drive.readonly` 允许读取和下载账号有权访问的 Drive 文件。单独增加元数据读取只能解决列举问题，不能替代读取家谱 JSON 和照片所需的内容权限。`drive.readonly` 仍属于 restricted scope，公开发布仍需考虑对应验证。[官方 scope 定义](https://developers.google.com/workspace/drive/api/guides/api-specific-auth#drive_api_scopes)

Google 官方错误指南把应用未获得文件授权列为 `appNotAuthorizedToFile`，建议通过 Picker 或 Open with 取得授权，并可检查 `isAppAuthorized`。因此不能根据“文件来自同一个应用”和“接收方在网页有权限”推断接收方的应用连接已获得逐文件访问权；具体是否为此次失败原因仍以真实请求为准。[官方错误处理](https://developers.google.com/workspace/drive/api/guides/handle-errors#appnotauthorizedtofile)

`files.list` 接受 `drive.readonly`，支持查询条件与分页。私有 `appProperties` 的可见性按应用区分；扩大读取 scope 不会自动使另一 OAuth 应用的私有标记可见。本轮保留同一 OAuth 应用。[files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list#authorization-scopes) · [私有属性说明](https://developers.google.com/workspace/drive/api/guides/properties)

## 实施前的代码基线（aa26cec）

| 已确认事实 | 位置 | 含义 |
| --- | --- | --- |
| 只请求 drive.file | [googleDriveClient.ts](../../src/services/storage/googleDriveClient.ts#L2) | 该基线没有广泛读取能力 |
| 按 familyTree/kind 标记查询项目，无 owners 或 root 过滤 | [googleDrive.ts](../../src/services/storage/googleDrive.ts#L89-L93) · [listProjects](../../src/services/storage/googleDrive.ts#L281-L289) | 暂无证据需要拆分自有与共享查询 |
| 使用 corpora=user，并处理分页和 incompleteSearch | [googleDriveClient.ts](../../src/services/storage/googleDriveClient.ts#L313-L335) | 不需要从个人根目录递归遍历来发现项目 |
| 打开项目后按项目父目录及标记读取版本与照片 | [googleDrive.ts](../../src/services/storage/googleDrive.ts#L89-L93) | 可复用现有读取路径，保留格式校验 |

## 推荐的下一步

1. 保留现有项目查询、统一列表及读取路径，先制作使用 `drive.readonly + drive.file` 的验证版本；不预先请求完整 `drive`。
2. 同步更新授权回调与缓存的 scope 集合检查，使旧的单 scope token 不被误当成新授权。Google 控制台声明与应用请求必须一致。[授权配置说明](https://developers.google.com/workspace/drive/api/guides/api-specific-auth#configure_oauth_2.0_for_authorization)
3. 用开发者构造的虚构家谱和两个测试账号检验：A 创建并共享，B 重新授权后通过相同列表打开，版本与主图、缩略图均可读取。已有失败现象作为基线，不以用户提供私人资料为前提。
4. 发现和读取通过后，再验证编辑权限下追加版本、上传和重命名；不要把已验证的读取能力扩大表述成完整协作能力。只读浏览保护仍按原方案完成。

后续实现已加入双 scope、旧授权检查、统一列表和只读保护，使用方式与限制见 [Google Drive 使用说明](../google-drive.md)。真实双账号 OAuth、共享写入及 Google 控制台配置仍需部署者验收；自动化替身不能证明真实授权成功。本次未更改任何真实 Drive 权限。外部源码链接指向研究时检查的公开分支，后续可能发生变化。

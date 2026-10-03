# 项目与备份格式

Family Tree 的领域数据共用 `schemaVersion=4`。本地项目使用用户授权的普通目录，推荐目录名以 `.family` 结尾，但识别依赖标记文件；Google Drive 使用下文的独立版本封装。两者均能导出 `.familybundle`，不应把 Drive 内部文件布局当作可直接打开的本地目录。

## 目录结构

```text
MyFamily.family/
├── meta.json
├── family.json
├── family.json.bak.1
├── family.json.bak.2
├── family.json.bak.3
├── media/
│   ├── photos/<photoId>.webp
│   └── thumbs/<photoId>.webp
└── .trash/
```

`meta.json` 和 `family.json` 都存在时目录才被视为项目。`media`、`.trash` 和备份文件可按需创建。

项目在应用内由 `{ providerId, id, displayName }` 形式的 `ProjectRef` 标识：浏览器目录使用 IndexedDB 句柄记录 ID，Drive 使用云端项目文件夹 ID，并由提供商标识绑定 OAuth 应用与 Google 账号。引用只属于设备会话和偏好设置，不写入 `family.json`，因此增加存储提供商无需改变领域数据格式。浏览器 IndexedDB 不保存家谱或照片副本。

## 当前版本

当前 `schemaVersion` 为 **4**，定义在 `src/core/schema.ts`。

`meta.json` 示例：

```json
{
  "name": "示例家族",
  "schemaVersion": 4,
  "createdAt": "2026-07-16T00:00:00Z",
  "updatedAt": "2026-07-16T00:00:00Z"
}
```

`family.json` 顶层字段：

| 字段 | 说明 |
|---|---|
| `schemaVersion` | 格式版本，保存时必须等于 4 |
| `members` | `memberId -> Member` 映射，键必须等于成员内部 `id` |
| `nicknameOverrides` | 指定两名成员之间的自定义称谓 |
| `siblingOrders` | 按兄弟姐妹关系组保存的共享顺序（同父母组使用 `parentage:*`，跨父母组或显式关系使用 `siblings:*`），用于布局和长幼称呼；未设置时按出生日期排序 |
| `layoutPreferences` | 根域、行、桥域顺序和稳定配色偏好 |
| `childLayoutAssignments` | 旧格式兼容的主父母布局选择 |
| `manualPositions` | 已废弃的旧手工坐标，仅为兼容保留 |
| `gridLayoutOverrides` | 已废弃的旧网格偏好，仅为兼容保留 |
| `rootMemberId` | 可选根成员引用 |
| `defaultViewpointId` | 可选的上次视角成员引用 |

未知字段会被保留，以便渐进兼容；核心字段仍必须通过 Zod 和关系图校验。

布局模式选择、网格 pan/zoom、纵流聚焦点、展开分支和滚动位置属于设备本地 UI 状态，不写入 `family.json`。纵流布局复用 `siblingOrders` 的语义顺序，但不会读取或修改网格专用的 `layoutPreferences`，因此本次双布局能力不需要提升 schema 版本。

## 关系图不变量

- 所有成员、顶层指针、称谓覆盖和布局成员引用必须指向现有成员。
- `members` 的映射键必须等于成员 `id`。
- 关系不允许自引用或同一列表内的重复成员。
- 父母/子女、兄弟姐妹、配偶关系必须有类型一致的反向引用。
- `godparents` 的反向类型是 `godchild`；`godchildren` 的反向类型是 `godparent`。
- 每名成员最多有一个 `married` 当前配偶，可保留多个 `divorced` 历史配偶。
- 父母链不能形成祖先环。

不满足这些约束的项目会拒绝打开或保存，并报告字段路径。

## 版本迁移

`src/core/migrate.ts` 负责把 0–3 版本逐步转换到版本 4，包括配偶关系规范化、旧布局字段转换和偏好协调。高于当前版本的文件会拒绝打开，避免旧版本网页破坏新数据。

格式变更必须同时：

1. 递增 `src/core/schema.ts` 中的版本常量；
2. 添加从上一版本到新版本的确定性迁移；
3. 添加旧文件、重复迁移和未来版本拒绝测试；
4. 更新本文和 changelog。

## 本地目录写入与恢复

- `family.json` 最大 50 MiB。
- 每次保存前最多轮转三份 `.bak.N`。
- 浏览器先复制滚动备份，再使用 `createWritable()` 写入，等待 `close()` 提交主文件；失败时中止流。新建要求空目录，失败清理只针对本次创建的文件。
- 自动保存按修订号串行执行；旧保存结果不能清除新修改的脏状态。
- 浏览器写前比较已加载内容与磁盘内容，发现变化时拒绝覆盖。同来源 Web Locks 不能阻止其他来源或外部程序写入；这不是跨程序原子比较交换，请避免同时编辑。
- 主文件、元数据和媒体不是一次整项目事务。磁盘满、权限撤销或进程中断后，应保留原目录和备份再恢复。
- 如果主文件损坏，可在应用关闭后备份整个目录，再人工选择最近的 `.bak.N` 恢复为 `family.json`。

## Google Drive 版本格式

每个 Drive 项目是“我的云端硬盘”中的文件夹，使用私有 `appProperties` 识别归属；文件名只供查看，不作为唯一标识。项目文件夹下保存不可变版本 JSON、WebP 主图和缩略图，没有持续覆盖的 `family.json` 或三份滚动备份。

版本封装的 `formatVersion` 当前为 **1**，与内部家谱的 `schemaVersion=4` 分开：

```ts
interface DriveRevision {
  formatVersion: 1
  projectId: string
  revisionId: string
  parents: string[]
  meta: ProjectMeta
  family: FamilyData
}
```

`projectId` 是项目文件夹 ID，`revisionId` 是本次快照文件 ID，`parents` 是基于的历史版本 ID。首次保存没有父版本；普通保存基于一个版本；解决多个分支时，新版本引用已确认的全部分支。快照总大小上限 51 MiB，内部家谱 50 MiB、元数据 1 MiB；文件归属、索引和父子关系均校验。版本图中的缺失节点或循环会拒绝加载。

应用每次保存追加完整快照，不删除历史；照片也保留以支持历史读取。发现多个当前分支时必须显式选择内容，不自动按时间覆盖。不要从 Drive 手工修改、移动或单独删除内部版本和照片，否则可能破坏历史。Drive 文件夹下载后不能直接当作 `.family` 打开；跨存储迁移使用应用的另存或 `.familybundle` 导出。具体行为见 [Google Drive](google-drive.md)。

## `.familybundle` 备份包

`.familybundle` 延续既有备份格式，是版本化 ZIP 容器，当前 `archiveVersion` 为 **1**：

```text
archive.json
project/meta.json
project/family.json
project/media/photos/<photoId>.webp
project/media/thumbs/<photoId>.webp
```

备份包不包含 `.trash`、滚动备份文件或 Drive 版本历史，仅包含导出时的项目快照。导出仅包含家谱引用的主图与缩略图。旧版应用导出的兼容归档仍可导入，归档校验规则保持生效。

- Web 先选择备份文件，再点击选择空目录导入；逐条有界解压并校验，完整读取媒体后才写项目标记。失败时尽力清理本次创建且未被外部修改的文件，不递归删除目录，也不承诺目录级原子提交。
- 本地和 Drive 项目均可导出；支持 `showSaveFilePicker` 时通过文件流顺序压缩，失败时中止文件流。无保存选择器时使用最多 128 MiB 的内存归档，完成后提供下载链接，由用户点击保存；超限应改用支持文件流的桌面浏览器。任何被引用照片不可读时，完整导出都会失败。
- 导入目标目前仍为本地空目录，不直接导入 Drive。没有目录 API 的设备可导出 Drive 项目，但需借助支持目录 API 的浏览器恢复归档后再另存到 Drive。

包大小上限为 512 MiB、条目数 5000、解压总量 1 GiB；`archive.json`/`meta.json` 最大 1 MiB，`family.json` 最大 50 MiB，单个媒体最大 25 MiB。导入拒绝路径穿越、符号链接、重复/未知条目和未来版本。Web 还限制 ZIP 中央目录索引为 8 MiB，检查真实解压输出大小和 CRC，不只相信 ZIP 声明的大小。请把 `.familybundle` 当作不加密的完整个人数据备份妥善保管。

## 照片媒体

- `photoId` 长度为 1–128，只允许 `[A-Za-z0-9_-]`。
- 导入文件最大 25 MiB、最大 4000 万像素。
- Web 支持 PNG、JPEG、WebP，检查文件头后解码，不只信任扩展名或 MIME。
- 主图最长边缩放到 1600px，缩略图最长边 256px，均写为 WebP；主图不一定保留原始分辨率，不能替代原始照片备份。
- 本地删除先复制主图/缩略图到 `.trash` 再删除原文件；Drive 移除当前家谱引用时保留媒体，以供历史版本使用。两种提供商均不提供 GC；操作只针对授权项目。

## 隐私说明

项目文件、照片和 `.familybundle` 没有应用层加密。本地项目不会自动上传；用户选择 Drive 后，自动保存和照片操作直接写入该账号的云盘。Drive 可跨设备打开，但不提供持续同步或自动冲突合并。请使用操作系统磁盘加密、账户权限和可靠备份保护真实家谱。清除网页站点数据会丢失句柄和缓存，但不删除用户普通目录或 Drive 文件。提交 Issue 或测试 fixture 时只能使用虚构或充分脱敏的数据。

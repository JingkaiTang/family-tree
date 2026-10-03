# `.family` 项目格式

Family Tree 使用目录作为项目。Web/PWA 打开用户选择并授权的普通目录。推荐目录名以 `.family` 结尾，但格式识别依赖目录内的项目标记文件，而不是扩展名。

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

项目在应用内由 `{ providerId, id, displayName }` 形式的 `ProjectRef` 标识：浏览器目录使用 IndexedDB 句柄记录 ID。引用只属于设备会话和偏好设置，不写入 `family.json`，因此无需为移除原生客户端改变数据格式。浏览器 IndexedDB 不保存家谱或照片副本。

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

## 写入与恢复

- `family.json` 最大 50 MiB。
- 每次保存前最多轮转三份 `.bak.N`。
- 浏览器先复制滚动备份，再使用 `createWritable()` 写入，等待 `close()` 提交主文件；失败时中止流。新建要求空目录，失败清理只针对本次创建的文件。
- 自动保存按修订号串行执行；旧保存结果不能清除新修改的脏状态。
- 浏览器写前比较已加载内容与磁盘内容，发现变化时拒绝覆盖。同来源 Web Locks 不能阻止其他来源或外部程序写入；这不是跨程序原子比较交换，请避免同时编辑。
- 主文件、元数据和媒体不是一次整项目事务。磁盘满、权限撤销或进程中断后，应保留原目录和备份再恢复。
- 如果主文件损坏，可在应用关闭后备份整个目录，再人工选择最近的 `.bak.N` 恢复为 `family.json`。

## `.familybundle` 备份包

`.familybundle` 延续既有备份格式，是版本化 ZIP 容器，当前 `archiveVersion` 为 **1**：

```text
archive.json
project/meta.json
project/family.json
project/media/photos/<photoId>.webp
project/media/thumbs/<photoId>.webp
```

备份包不包含 `.trash` 和滚动备份文件。导出仅包含家谱引用的主图与缩略图。旧版应用导出的兼容归档仍可导入，归档校验规则保持生效。

- Web 先选择备份文件，再点击选择空目录导入；逐条有界解压并校验，完整读取媒体后才写项目标记。失败时尽力清理本次创建且未被外部修改的文件，不递归删除目录，也不承诺目录级原子提交。
- Web 导出通过文件可写流顺序压缩，不构造整包 Blob；输出失败时中止文件流。

包大小上限为 512 MiB、条目数 5000、解压总量 1 GiB；`archive.json`/`meta.json` 最大 1 MiB，`family.json` 最大 50 MiB，单个媒体最大 25 MiB。导入拒绝路径穿越、符号链接、重复/未知条目和未来版本。Web 还限制 ZIP 中央目录索引为 8 MiB，检查真实解压输出大小和 CRC，不只相信 ZIP 声明的大小。请把 `.familybundle` 当作不加密的完整个人数据备份妥善保管。

## 照片媒体

- `photoId` 长度为 1–128，只允许 `[A-Za-z0-9_-]`。
- 导入文件最大 25 MiB、最大 4000 万像素。
- Web 支持 PNG、JPEG、WebP，检查文件头后解码，不只信任扩展名或 MIME。
- 主图最长边缩放到 1600px，缩略图最长边 256px，均写为 WebP；主图不一定保留原始分辨率，不能替代原始照片备份。
- 删除先复制主图/缩略图回收副本到 `.trash` 再删除原文件，暂不提供 GC。存储操作不得越过授权项目目录访问任意文件。

## 隐私说明

项目文件、照片和 `.familybundle` 不加密，也不会自动上传或跨设备同步。请使用操作系统磁盘加密、账户权限和可靠备份保护真实家谱。清除网页站点数据会丢失句柄和缓存，但不删除用户普通目录。提交 Issue 或测试 fixture 时只能使用虚构或充分脱敏的数据。

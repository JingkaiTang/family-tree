# `.family` 项目格式

Family Tree 使用普通目录作为项目。推荐目录名以 `.family` 结尾，但格式识别依赖目录内的项目标记文件，而不是扩展名。

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

## 当前版本

当前 `schemaVersion` 为 **4**，定义在 `src/core/schema.ts` 和 `src-tauri/src/commands/project.rs`。两端版本必须同步。

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
| `layoutPreferences` | 根域、行、桥域顺序和稳定配色偏好 |
| `childLayoutAssignments` | 旧格式兼容的主父母布局选择 |
| `manualPositions` | 已废弃的旧手工坐标，仅为兼容保留 |
| `gridLayoutOverrides` | 已废弃的旧网格偏好，仅为兼容保留 |
| `rootMemberId` | 可选根成员引用 |
| `defaultViewpointId` | 可选的上次视角成员引用 |

未知字段会被保留，以便渐进兼容；核心字段仍必须通过 Zod 和关系图校验。

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

`src/core/migrate.ts` 负责把 0–3 版本逐步转换到版本 4，包括配偶关系规范化、旧布局字段转换和偏好协调。高于当前版本的文件会拒绝打开，避免旧客户端破坏新数据。

格式变更必须同时：

1. 递增前端和 Rust 版本常量；
2. 添加从上一版本到新版本的确定性迁移；
3. 添加旧文件、重复迁移和未来版本拒绝测试；
4. 更新本文和 changelog。

## 写入与恢复

- `family.json` 最大 50 MiB。
- 每次保存前最多轮转三份 `.bak.N`。
- 主文件使用同目录临时文件写入后 rename，降低半写入风险。
- 自动保存按修订号串行执行；旧保存结果不能清除新修改的脏状态。
- 如果主文件损坏，可在应用关闭后备份整个目录，再人工选择最近的 `.bak.N` 恢复为 `family.json`。

## 照片媒体

- `photoId` 长度为 1–128，只允许 `[A-Za-z0-9_-]`。
- 导入文件最大 25 MiB、最大 4000 万像素。
- 原图最长边缩放到 1600px，缩略图最长边 256px，均写为 WebP。
- 删除和 GC 会将文件移入 `.trash`，不会直接越过项目目录删除任意文件。

## 隐私说明

项目文件和照片不加密，也不会自动上传。请使用操作系统磁盘加密、账户权限和可靠备份保护真实家谱。提交 Issue 或测试 fixture 时只能使用虚构或充分脱敏的数据。

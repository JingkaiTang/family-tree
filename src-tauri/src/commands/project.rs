use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::errors::{CmdError, CmdResult};

// ============================================================
// Types
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub name: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectRef {
    External { path: String },
    Managed { id: String },
}

#[derive(Debug, Serialize)]
pub struct LoadedProject {
    pub project: ProjectRef,
    pub meta: ProjectMeta,
    pub family: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ManagedProjectSummary {
    pub project: ProjectRef,
    pub meta: ProjectMeta,
}

const FAMILY_FILE: &str = "family.json";
const META_FILE: &str = "meta.json";
const MEDIA_DIR: &str = "media";
const PHOTOS_SUBDIR: &str = "photos";
const THUMBS_SUBDIR: &str = "thumbs";
const TRASH_SUBDIR: &str = ".trash";
const CURRENT_SCHEMA_VERSION: u32 = 4;
const MAX_BAK_COUNT: usize = 3;
const MAX_FAMILY_JSON_BYTES: u64 = 50 * 1024 * 1024;
const MANAGED_PROJECTS_DIR: &str = "projects";
const MANAGED_PROJECT_SUFFIX: &str = ".family";

// ============================================================
// Helpers
// ============================================================

fn now_iso() -> String {
    // 简易 ISO 8601 时间戳。不引入 chrono，用 std + 基本格式化。
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 退化为秒级时间戳字符串，前端只把它当 opaque 的 ISO 字段使用
    // 为了兼容 JS Date.parse，这里仍然构造一个粗略的 ISO 字符串。
    format_iso_utc(secs)
}

fn format_iso_utc(epoch_secs: u64) -> String {
    // 不使用 chrono 的简易 UTC 格式化（足够用于 createdAt/updatedAt 标记）
    // 基于 1970-01-01 算年月日
    let mut days = (epoch_secs / 86_400) as i64;
    let mut secs_of_day = (epoch_secs % 86_400) as i64;
    let hour = secs_of_day / 3600;
    secs_of_day %= 3600;
    let minute = secs_of_day / 60;
    let second = secs_of_day % 60;

    // 计算年月日（Zeller-ish）：简单循环
    let mut year: i64 = 1970;
    loop {
        let leap = is_leap(year);
        let ydays = if leap { 366 } else { 365 };
        if days >= ydays {
            days -= ydays;
            year += 1;
        } else {
            break;
        }
    }
    let months_days = [31u8, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month: i64 = 1;
    for (i, &md) in months_days.iter().enumerate() {
        let mut mdays = md as i64;
        if i == 1 && is_leap(year) {
            mdays = 29;
        }
        if days >= mdays {
            days -= mdays;
            month += 1;
        } else {
            break;
        }
    }
    let day = days + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn validate_absolute_directory(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(CmdError::InvalidPath(format!(
            "路径必须为绝对路径：{}",
            path
        )));
    }
    if p.components()
        .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(CmdError::InvalidPath(format!(
            "路径不能包含 . 或 ..：{}",
            path
        )));
    }
    let canonical = fs::canonicalize(&p)
        .map_err(|_| CmdError::InvalidPath(format!("目录不存在或无法访问：{}", p.display())))?;
    if !canonical.is_dir() {
        return Err(CmdError::InvalidPath(format!(
            "路径不是目录：{}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

pub(crate) fn validate_project_root_path(path: &Path) -> CmdResult<PathBuf> {
    let path_string = path.to_string_lossy();
    let root = validate_absolute_directory(&path_string)?;
    for marker in [META_FILE, FAMILY_FILE] {
        if !root.join(marker).is_file() {
            return Err(CmdError::CorruptedProject(format!(
                "项目缺少 {}：{}",
                marker,
                root.display()
            )));
        }
    }
    Ok(root)
}

fn validate_managed_id(id: &str) -> CmdResult<&str> {
    uuid::Uuid::parse_str(id)
        .map_err(|_| CmdError::InvalidPath(format!("非法托管项目 ID：{}", id)))?;
    Ok(id)
}

fn app_data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| CmdError::Other(format!("无法定位 AppData：{}", error)))
}

pub(crate) fn managed_projects_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app_data_dir(app)?.join(MANAGED_PROJECTS_DIR))
}

pub(crate) fn managed_project_root(base: &Path, id: &str) -> CmdResult<PathBuf> {
    let id = validate_managed_id(id)?;
    Ok(base.join(format!("{}{}", id, MANAGED_PROJECT_SUFFIX)))
}

pub(crate) fn resolve_project_root(app: &AppHandle, project: &ProjectRef) -> CmdResult<PathBuf> {
    let managed_base = managed_projects_dir(app)?;
    resolve_project_root_from_base(project, &managed_base, cfg!(mobile))
}

fn validate_project_platform(project: &ProjectRef, mobile: bool) -> CmdResult<()> {
    if mobile && matches!(project, ProjectRef::External { .. }) {
        return Err(CmdError::InvalidPath(
            "移动端仅允许 AppData 托管项目".into(),
        ));
    }
    Ok(())
}

pub(crate) fn resolve_project_root_from_base(
    project: &ProjectRef,
    managed_base: &Path,
    mobile: bool,
) -> CmdResult<PathBuf> {
    validate_project_platform(project, mobile)?;
    match project {
        ProjectRef::External { path } => validate_project_root_path(Path::new(path)),
        ProjectRef::Managed { id } => {
            let root = managed_project_root(managed_base, id)?;
            let canonical_root = validate_project_root_path(&root)?;
            let canonical_base = fs::canonicalize(managed_base).map_err(|_| {
                CmdError::InvalidPath(format!("托管项目目录不存在：{}", managed_base.display()))
            })?;
            if !canonical_root.starts_with(&canonical_base) {
                return Err(CmdError::InvalidPath("托管项目越出 AppData 边界".into()));
            }
            Ok(canonical_root)
        }
    }
}

fn ensure_dirs(root: &Path) -> CmdResult<()> {
    fs::create_dir_all(root)?;
    fs::create_dir_all(root.join(MEDIA_DIR).join(PHOTOS_SUBDIR))?;
    fs::create_dir_all(root.join(MEDIA_DIR).join(THUMBS_SUBDIR))?;
    fs::create_dir_all(root.join(TRASH_SUBDIR))?;
    Ok(())
}

fn read_meta(root: &Path) -> CmdResult<ProjectMeta> {
    let meta_path = root.join(META_FILE);
    let bytes = fs::read(&meta_path)
        .map_err(|_| CmdError::CorruptedProject(format!("找不到 {}", meta_path.display())))?;
    let meta: ProjectMeta = serde_json::from_slice(&bytes)?;
    Ok(meta)
}

fn write_meta(root: &Path, meta: &ProjectMeta) -> CmdResult<()> {
    let json = serde_json::to_string_pretty(meta)?;
    atomic_write(&root.join(META_FILE), json.as_bytes())
}

/// 临时文件 + rename 原子写入。写前不做 .bak 轮转（由 save_project 控制）。
fn atomic_write(target: &Path, bytes: &[u8]) -> CmdResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| CmdError::InvalidPath(target.display().to_string()))?;
    fs::create_dir_all(parent)?;
    let mut tmp = target.to_path_buf();
    let file_name = target.file_name().and_then(|s| s.to_str()).unwrap_or("tmp");
    tmp.set_file_name(format!(".{}.tmp", file_name));
    fs::write(&tmp, bytes)?;
    // 若目标存在，rename 覆盖；macOS/Linux 原子；Windows 2019+ 也原子
    fs::rename(&tmp, target)?;
    Ok(())
}

/// 保存前把当前 family.json 轮转为 .bak.N（最多 MAX_BAK_COUNT 份）
fn rotate_backups(root: &Path) -> CmdResult<()> {
    let family_path = root.join(FAMILY_FILE);
    if !family_path.exists() {
        return Ok(());
    }
    // 删最老的
    let oldest = root.join(format!("{}.bak.{}", FAMILY_FILE, MAX_BAK_COUNT));
    let _ = fs::remove_file(&oldest);
    // N..1 向后挪一位
    for i in (1..MAX_BAK_COUNT).rev() {
        let src = root.join(format!("{}.bak.{}", FAMILY_FILE, i));
        let dst = root.join(format!("{}.bak.{}", FAMILY_FILE, i + 1));
        if src.exists() {
            let _ = fs::rename(&src, &dst);
        }
    }
    // 当前 → .bak.1
    let bak1 = root.join(format!("{}.bak.1", FAMILY_FILE));
    let _ = fs::copy(&family_path, &bak1);
    Ok(())
}

// ============================================================
// Commands
// ============================================================

pub(crate) fn initialize_project(root: &Path, name: &str) -> CmdResult<ProjectMeta> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(CmdError::Other("项目名称须为 1 到 100 个字符".into()));
    }

    // 任一项目标记已存在都拒绝覆盖，避免把损坏项目当成新项目重建。
    if root.join(FAMILY_FILE).exists() || root.join(META_FILE).exists() {
        return Err(CmdError::Other(
            "该目录已存在家族项目文件，请改用\"打开\"。".into(),
        ));
    }
    ensure_dirs(root)?;

    let now = now_iso();
    let meta = ProjectMeta {
        name: name.to_string(),
        schema_version: CURRENT_SCHEMA_VERSION,
        created_at: now.clone(),
        updated_at: now,
    };
    write_meta(root, &meta)?;

    // 写一份空 family.json 占位（前端会再写一次完整数据，但这里保证目录完整性）
    let empty = serde_json::json!({
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "members": {},
        "nicknameOverrides": {}
    });
    atomic_write(
        &root.join(FAMILY_FILE),
        serde_json::to_string_pretty(&empty)?.as_bytes(),
    )?;

    Ok(meta)
}

fn load_project_from_root(root: &Path, project: ProjectRef) -> CmdResult<LoadedProject> {
    let root = validate_project_root_path(root)?;
    ensure_dirs(&root)?;

    let meta = read_meta(&root)?;
    let family_path = root.join(FAMILY_FILE);
    let family_size = fs::metadata(&family_path)?.len();
    if family_size > MAX_FAMILY_JSON_BYTES {
        return Err(CmdError::CorruptedProject(format!(
            "{} 超过 50 MiB 限制",
            family_path.display()
        )));
    }
    let family_bytes = fs::read(&family_path)
        .map_err(|_| CmdError::CorruptedProject(format!("找不到 {}", family_path.display())))?;
    let family: serde_json::Value = serde_json::from_slice(&family_bytes)?;

    Ok(LoadedProject {
        project: match project {
            ProjectRef::External { .. } => ProjectRef::External {
                path: root.to_string_lossy().to_string(),
            },
            managed @ ProjectRef::Managed { .. } => managed,
        },
        meta,
        family,
    })
}

pub(crate) fn save_project_at(root: &Path, family_json: &str) -> CmdResult<()> {
    let root = validate_project_root_path(root)?;
    if family_json.len() as u64 > MAX_FAMILY_JSON_BYTES {
        return Err(CmdError::Other("family.json 超过 50 MiB 限制".into()));
    }

    // Rust 层只校验 JSON 和格式版本；完整 schema 与关系图约束由前端校验。
    let parsed: serde_json::Value = serde_json::from_str(family_json)?;
    if parsed.get("schemaVersion").and_then(|value| value.as_u64())
        != Some(u64::from(CURRENT_SCHEMA_VERSION))
    {
        return Err(CmdError::Other(format!(
            "family.json 的 schemaVersion 必须为 {}",
            CURRENT_SCHEMA_VERSION
        )));
    }

    rotate_backups(&root)?;
    atomic_write(&root.join(FAMILY_FILE), family_json.as_bytes())?;

    // 更新 meta.updatedAt
    if let Ok(mut meta) = read_meta(&root) {
        meta.schema_version = CURRENT_SCHEMA_VERSION;
        meta.updated_at = now_iso();
        let _ = write_meta(&root, &meta);
    }

    Ok(())
}

#[tauri::command]
pub fn create_project(app: AppHandle, project: ProjectRef, name: String) -> CmdResult<ProjectMeta> {
    let managed_base = managed_projects_dir(&app)?;
    create_project_with_base(&project, &name, &managed_base, cfg!(mobile))
}

fn create_project_with_base(
    project: &ProjectRef,
    name: &str,
    managed_base: &Path,
    mobile: bool,
) -> CmdResult<ProjectMeta> {
    validate_project_platform(project, mobile)?;
    let (root, remove_on_error) = match project {
        ProjectRef::External { path } => (validate_absolute_directory(path)?, false),
        ProjectRef::Managed { id } => {
            fs::create_dir_all(managed_base)?;
            let root = managed_project_root(managed_base, id)?;
            if root.exists() {
                return Err(CmdError::Other("该托管项目已存在".into()));
            }
            fs::create_dir(&root)?;
            (fs::canonicalize(root)?, true)
        }
    };

    match initialize_project(&root, name) {
        Ok(meta) => Ok(meta),
        Err(error) => {
            if remove_on_error {
                let _ = fs::remove_dir_all(&root);
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_managed_projects(app: AppHandle) -> CmdResult<Vec<ManagedProjectSummary>> {
    let base = managed_projects_dir(&app)?;
    list_managed_projects_at(&base)
}

fn list_managed_projects_at(base: &Path) -> CmdResult<Vec<ManagedProjectSummary>> {
    fs::create_dir_all(base)?;
    let mut projects = Vec::new();

    for entry in fs::read_dir(base)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        let Some(id) = file_name.strip_suffix(MANAGED_PROJECT_SUFFIX) else {
            continue;
        };
        if validate_managed_id(id).is_err() {
            continue;
        }
        let Ok(root) = validate_project_root_path(&entry.path()) else {
            continue;
        };
        let Ok(meta) = read_meta(&root) else {
            continue;
        };
        projects.push(ManagedProjectSummary {
            project: ProjectRef::Managed { id: id.to_string() },
            meta,
        });
    }

    projects.sort_by(|left, right| {
        right
            .meta
            .updated_at
            .cmp(&left.meta.updated_at)
            .then_with(|| left.meta.name.cmp(&right.meta.name))
    });
    Ok(projects)
}

#[tauri::command]
pub fn load_project(app: AppHandle, project: ProjectRef) -> CmdResult<LoadedProject> {
    let root = resolve_project_root(&app, &project)?;
    load_project_from_root(&root, project)
}

#[tauri::command]
pub fn save_project(app: AppHandle, project: ProjectRef, family_json: String) -> CmdResult<()> {
    let root = resolve_project_root(&app, &project)?;
    save_project_at(&root, &family_json)
}

#[tauri::command]
pub fn runtime_platform() -> &'static str {
    std::env::consts::OS
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmp_dir(name: &str) -> PathBuf {
        let mut p = env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("family_tree_test_{}_{}", name, stamp));
        p
    }

    fn external_project(root: &Path) -> ProjectRef {
        ProjectRef::External {
            path: root.to_string_lossy().to_string(),
        }
    }

    #[test]
    fn create_load_save_roundtrip() {
        let root = tmp_dir("roundtrip");
        fs::create_dir_all(&root).unwrap();

        // create
        let meta = initialize_project(&root, "测试家族").expect("create");
        assert_eq!(meta.name, "测试家族");
        assert!(root.join(FAMILY_FILE).exists());
        assert!(root.join(META_FILE).exists());
        assert!(root.join(MEDIA_DIR).join(PHOTOS_SUBDIR).exists());

        // create again should fail (dir already has project)
        let err = initialize_project(&root, "re").unwrap_err();
        assert!(matches!(err, CmdError::Other(_)));

        // load
        let loaded = load_project_from_root(&root, external_project(&root)).expect("load");
        assert_eq!(loaded.meta.name, "测试家族");
        assert!(loaded.family.get("members").is_some());

        // save then load again
        let new_family = serde_json::json!({
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "members": {
                "m1": {
                    "id": "m1",
                    "firstName": "三",
                    "lastName": "张",
                    "gender": "male",
                    "parents": [], "children": [], "siblings": [], "spouses": []
                }
            },
            "nicknameOverrides": {}
        });
        save_project_at(&root, &new_family.to_string()).expect("save");
        let loaded2 = load_project_from_root(&root, external_project(&root)).expect("load2");
        assert_eq!(
            loaded2.family["members"]["m1"]["firstName"],
            serde_json::Value::String("三".into())
        );
        assert_eq!(loaded2.meta.schema_version, CURRENT_SCHEMA_VERSION);

        // save again triggers a .bak.1
        save_project_at(&root, &new_family.to_string()).expect("save2");
        assert!(root.join("family.json.bak.1").exists());

        // cleanup
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_rejects_invalid_json() {
        let root = tmp_dir("badjson");
        fs::create_dir_all(&root).unwrap();
        initialize_project(&root, "x").unwrap();
        let err = save_project_at(&root, "not-json").unwrap_err();
        assert!(matches!(err, CmdError::Json(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_rejects_non_current_schema() {
        let root = tmp_dir("old-schema");
        fs::create_dir_all(&root).unwrap();
        initialize_project(&root, "x").unwrap();
        let err = save_project_at(&root, r#"{"schemaVersion":1}"#).unwrap_err();
        assert!(matches!(err, CmdError::Other(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_rejects_directory_without_project_markers() {
        let root = tmp_dir("not-project");
        fs::create_dir_all(&root).unwrap();
        let err = save_project_at(&root, "{}").unwrap_err();
        assert!(matches!(err, CmdError::CorruptedProject(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_validation_rejects_parent_segments() {
        let root = env::temp_dir();
        let path = root.join("child").join("..");
        let err = validate_absolute_directory(&path.to_string_lossy()).unwrap_err();
        assert!(matches!(err, CmdError::InvalidPath(_)));
    }

    #[test]
    fn managed_project_root_accepts_only_uuid_ids() {
        let base = tmp_dir("managed-base");
        let id = uuid::Uuid::new_v4().to_string();

        assert_eq!(
            managed_project_root(&base, &id).unwrap(),
            base.join(format!("{}.family", id))
        );
        assert!(managed_project_root(&base, "../escape").is_err());
        assert!(managed_project_root(&base, "not-a-uuid").is_err());
    }

    #[test]
    fn managed_project_create_list_load_save_roundtrip() {
        let base = tmp_dir("managed-roundtrip");
        let project = ProjectRef::Managed {
            id: uuid::Uuid::new_v4().to_string(),
        };

        let meta = create_project_with_base(&project, "移动家族", &base, true).unwrap();
        assert_eq!(meta.name, "移动家族");

        let root = resolve_project_root_from_base(&project, &base, true).unwrap();
        let family = serde_json::json!({
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "members": {},
            "nicknameOverrides": {}
        });
        save_project_at(&root, &family.to_string()).unwrap();

        let loaded = load_project_from_root(&root, project.clone()).unwrap();
        assert_eq!(loaded.project, project);
        assert_eq!(loaded.family["schemaVersion"], CURRENT_SCHEMA_VERSION);

        let projects = list_managed_projects_at(&base).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project, project);
        assert_eq!(projects[0].meta.name, "移动家族");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn mobile_rejects_external_creation_and_resolution_without_writing() {
        let base = tmp_dir("mobile-managed-base");
        let outside = tmp_dir("mobile-external");
        fs::create_dir_all(&outside).unwrap();
        let project = external_project(&outside);

        let error = create_project_with_base(&project, "外部项目", &base, true).unwrap_err();
        assert!(error.to_string().contains("移动端仅允许"));
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        assert!(!base.exists());

        initialize_project(&outside, "已有外部项目").unwrap();
        let error = resolve_project_root_from_base(&project, &base, true).unwrap_err();
        assert!(error.to_string().contains("移动端仅允许"));
        fs::remove_dir_all(outside).ok();
    }

    #[test]
    fn desktop_keeps_external_project_creation_and_resolution() {
        let base = tmp_dir("desktop-managed-base");
        let outside = tmp_dir("desktop-external");
        fs::create_dir_all(&outside).unwrap();
        let project = external_project(&outside);

        create_project_with_base(&project, "桌面项目", &base, false).unwrap();
        assert_eq!(
            resolve_project_root_from_base(&project, &base, false).unwrap(),
            fs::canonicalize(&outside).unwrap()
        );
        assert!(!base.exists());
        fs::remove_dir_all(outside).ok();
    }

    #[test]
    fn project_ref_uses_the_frontend_tagged_shape() {
        let project = ProjectRef::Managed {
            id: "00000000-0000-0000-0000-000000000000".into(),
        };

        assert_eq!(
            serde_json::to_value(project).unwrap(),
            serde_json::json!({
                "kind": "managed",
                "id": "00000000-0000-0000-0000-000000000000"
            })
        );
    }
}

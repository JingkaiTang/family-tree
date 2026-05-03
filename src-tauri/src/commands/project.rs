use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize)]
pub struct LoadedProject {
    pub path: String,
    pub meta: ProjectMeta,
    pub family: serde_json::Value,
}

const FAMILY_FILE: &str = "family.json";
const META_FILE: &str = "meta.json";
const MEDIA_DIR: &str = "media";
const PHOTOS_SUBDIR: &str = "photos";
const THUMBS_SUBDIR: &str = "thumbs";
const TRASH_SUBDIR: &str = ".trash";
const CURRENT_SCHEMA_VERSION: u32 = 1;
const MAX_BAK_COUNT: usize = 3;

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

fn validate_project_dir(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(CmdError::InvalidPath(format!(
            "路径必须为绝对路径：{}",
            path
        )));
    }
    Ok(p)
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
    let bytes = fs::read(&meta_path).map_err(|_| {
        CmdError::CorruptedProject(format!("找不到 {}", meta_path.display()))
    })?;
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
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("tmp");
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

#[tauri::command]
pub fn create_project(path: String, name: String) -> CmdResult<ProjectMeta> {
    let root = validate_project_dir(&path)?;
    ensure_dirs(&root)?;

    // 如果 family.json 已存在，拒绝覆盖
    if root.join(FAMILY_FILE).exists() {
        return Err(CmdError::Other(format!(
            "该目录已存在家族项目（{}），请改用\"打开\"。",
            FAMILY_FILE
        )));
    }

    let now = now_iso();
    let meta = ProjectMeta {
        name,
        schema_version: CURRENT_SCHEMA_VERSION,
        created_at: now.clone(),
        updated_at: now,
    };
    write_meta(&root, &meta)?;

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

#[tauri::command]
pub fn load_project(path: String) -> CmdResult<LoadedProject> {
    let root = validate_project_dir(&path)?;
    if !root.exists() {
        return Err(CmdError::InvalidPath(format!(
            "目录不存在：{}",
            root.display()
        )));
    }
    ensure_dirs(&root)?;

    let meta = read_meta(&root)?;
    let family_path = root.join(FAMILY_FILE);
    let family_bytes = fs::read(&family_path).map_err(|_| {
        CmdError::CorruptedProject(format!("找不到 {}", family_path.display()))
    })?;
    let family: serde_json::Value = serde_json::from_slice(&family_bytes)?;

    Ok(LoadedProject {
        path: root.to_string_lossy().to_string(),
        meta,
        family,
    })
}

#[tauri::command]
pub fn save_project(path: String, family_json: String) -> CmdResult<()> {
    let root = validate_project_dir(&path)?;
    if !root.exists() {
        return Err(CmdError::InvalidPath(format!(
            "目录不存在：{}",
            root.display()
        )));
    }

    // 先校验 JSON 合法（不做 schema 校验，schema 校验在前端 Zod 做）
    let _parsed: serde_json::Value = serde_json::from_str(&family_json)?;

    rotate_backups(&root)?;
    atomic_write(&root.join(FAMILY_FILE), family_json.as_bytes())?;

    // 更新 meta.updatedAt
    if let Ok(mut meta) = read_meta(&root) {
        meta.updated_at = now_iso();
        let _ = write_meta(&root, &meta);
    }

    Ok(())
}

/// M4 已由 commands::media 模块实现真正的 import/delete/gc，这里仅保留 resolve_photo_path
#[tauri::command]
pub fn resolve_photo_path(
    project_path: String,
    photo_id: String,
    thumb: bool,
) -> CmdResult<String> {
    let root = validate_project_dir(&project_path)?;
    let sub = if thumb { THUMBS_SUBDIR } else { PHOTOS_SUBDIR };
    let full = root
        .join(MEDIA_DIR)
        .join(sub)
        .join(format!("{}.webp", photo_id));
    Ok(full.to_string_lossy().to_string())
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

    #[test]
    fn create_load_save_roundtrip() {
        let root = tmp_dir("roundtrip");
        let root_s = root.to_string_lossy().to_string();

        // create
        let meta = create_project(root_s.clone(), "测试家族".into()).expect("create");
        assert_eq!(meta.name, "测试家族");
        assert!(root.join(FAMILY_FILE).exists());
        assert!(root.join(META_FILE).exists());
        assert!(root.join(MEDIA_DIR).join(PHOTOS_SUBDIR).exists());

        // create again should fail (dir already has project)
        let err = create_project(root_s.clone(), "re".into()).unwrap_err();
        assert!(matches!(err, CmdError::Other(_)));

        // load
        let loaded = load_project(root_s.clone()).expect("load");
        assert_eq!(loaded.meta.name, "测试家族");
        assert!(loaded.family.get("members").is_some());

        // save then load again
        let new_family = serde_json::json!({
            "schemaVersion": 1,
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
        save_project(root_s.clone(), new_family.to_string()).expect("save");
        let loaded2 = load_project(root_s.clone()).expect("load2");
        assert_eq!(
            loaded2.family["members"]["m1"]["firstName"],
            serde_json::Value::String("三".into())
        );

        // save again triggers a .bak.1
        save_project(root_s.clone(), new_family.to_string()).expect("save2");
        assert!(root.join("family.json.bak.1").exists());

        // cleanup
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_rejects_invalid_json() {
        let root = tmp_dir("badjson");
        let root_s = root.to_string_lossy().to_string();
        create_project(root_s.clone(), "x".into()).unwrap();
        let err = save_project(root_s.clone(), "not-json".into()).unwrap_err();
        assert!(matches!(err, CmdError::Json(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_photo_path_forms_correct_path() {
        let path = resolve_photo_path(
            "/tmp/FakeFamily".into(),
            "abc-123".into(),
            false,
        )
        .unwrap();
        assert!(path.ends_with("media/photos/abc-123.webp"));

        let thumb = resolve_photo_path("/tmp/FakeFamily".into(), "abc-123".into(), true).unwrap();
        assert!(thumb.ends_with("media/thumbs/abc-123.webp"));
    }
}

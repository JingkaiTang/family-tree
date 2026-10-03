use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::project::{
    managed_project_root, managed_projects_dir, resolve_project_root, validate_project_root_path,
    ManagedProjectSummary, ProjectMeta, ProjectRef,
};
use crate::errors::{CmdError, CmdResult};

const ARCHIVE_VERSION: u32 = 1;
const BUNDLE_SUFFIX: &str = ".familybundle";
const TRANSFERS_DIR: &str = "transfers";
const MANIFEST_FILE: &str = "archive.json";
const PROJECT_PREFIX: &str = "project";
const FAMILY_FILE: &str = "family.json";
const META_FILE: &str = "meta.json";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT: usize = 5_000;
const MAX_JSON_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 25 * 1024 * 1024;
const CURRENT_SCHEMA_VERSION: u64 = 4;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveManifest {
    archive_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExport {
    pub transfer_name: String,
    pub suggested_name: String,
}

fn validate_archive_size(size: u64) -> CmdResult<()> {
    if size > MAX_ARCHIVE_BYTES {
        return Err(CmdError::Other("备份包超过 512 MiB 限制".into()));
    }
    Ok(())
}

fn validate_entry_count(count: usize) -> CmdResult<()> {
    if count > MAX_ENTRY_COUNT {
        return Err(CmdError::Other("备份包文件数量超过 5000 个".into()));
    }
    Ok(())
}

/// 导入与导出共用逐文件和总体积限制，避免成功导出的备份无法恢复。
#[derive(Default)]
struct BundleBudget {
    entry_count: usize,
    extracted_bytes: u64,
}

impl BundleBudget {
    fn include_file(&mut self, path: &Path, size: u64) -> CmdResult<u64> {
        validate_entry_count(self.entry_count + 1)?;
        let max_size = max_entry_size(path)
            .ok_or_else(|| CmdError::Other(format!("备份包包含未知文件：{}", path.display())))?;
        if size > max_size {
            return Err(CmdError::Other(format!(
                "备份包条目过大：{}",
                path.display()
            )));
        }
        let extracted_bytes = self
            .extracted_bytes
            .checked_add(size)
            .ok_or_else(|| CmdError::Other("备份包解压大小溢出".into()))?;
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(CmdError::Other("备份包解压后超过 1 GiB 限制".into()));
        }
        self.entry_count += 1;
        self.extracted_bytes = extracted_bytes;
        Ok(max_size)
    }
}

fn transfer_name() -> String {
    format!("{}{}", uuid::Uuid::new_v4(), BUNDLE_SUFFIX)
}

fn validate_transfer_name(name: &str) -> CmdResult<&str> {
    let Some(id) = name.strip_suffix(BUNDLE_SUFFIX) else {
        return Err(CmdError::InvalidPath("传输文件扩展名无效".into()));
    };
    uuid::Uuid::parse_str(id)
        .map_err(|_| CmdError::InvalidPath(format!("非法传输文件名：{}", name)))?;
    Ok(name)
}

fn transfer_path(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    validate_transfer_name(name)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| CmdError::Other(format!("无法定位 AppCache：{}", error)))?;
    Ok(cache.join(TRANSFERS_DIR).join(name))
}

fn validate_photo_file_name(path: &Path) -> CmdResult<()> {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| CmdError::CorruptedProject("媒体文件名不是有效 UTF-8".into()))?;
    if path.extension().and_then(|value| value.to_str()) != Some("webp")
        || stem.is_empty()
        || stem.len() > 128
        || !stem
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err(CmdError::CorruptedProject(format!(
            "非法媒体文件名：{}",
            path.display()
        )));
    }
    Ok(())
}

fn file_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600)
}

fn write_bytes<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    budget: &mut BundleBudget,
    archive_path: &str,
    bytes: &[u8],
) -> CmdResult<()> {
    budget.include_file(Path::new(archive_path), bytes.len() as u64)?;
    writer.start_file(archive_path, file_options())?;
    writer.write_all(bytes)?;
    Ok(())
}

fn write_file<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    budget: &mut BundleBudget,
    archive_path: &str,
    source: &Path,
) -> CmdResult<()> {
    let file = File::open(source)?;
    let expected = file.metadata()?.len();
    let max_size = budget.include_file(Path::new(archive_path), expected)?;
    writer.start_file(archive_path, file_options())?;
    let copied = io::copy(&mut file.take(max_size + 1), writer)?;
    if copied != expected {
        return Err(CmdError::Other(format!(
            "导出期间媒体文件大小发生变化：{}",
            source.display()
        )));
    }
    Ok(())
}

fn media_files(root: &Path, subdir: &str) -> CmdResult<Vec<PathBuf>> {
    let directory = root.join("media").join(subdir);
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() || !entry.file_type()?.is_file() {
            return Err(CmdError::CorruptedProject(format!(
                "媒体目录包含不支持的条目：{}",
                entry.path().display()
            )));
        }
        validate_photo_file_name(&entry.path())?;
        files.push(entry.path());
    }
    files.sort();
    Ok(files)
}

fn export_bundle_at(project_root: &Path, destination: &Path) -> CmdResult<ProjectMeta> {
    let root = validate_project_root_path(project_root)?;
    let meta_bytes = fs::read(root.join(META_FILE))?;
    let family_bytes = fs::read(root.join(FAMILY_FILE))?;
    fs::create_dir_all(
        destination
            .parent()
            .ok_or_else(|| CmdError::InvalidPath(destination.display().to_string()))?,
    )?;

    let result = (|| -> CmdResult<ProjectMeta> {
        let file = File::create(destination)?;
        let mut writer = ZipWriter::new(file);
        let mut budget = BundleBudget::default();
        let manifest = serde_json::to_vec_pretty(&ArchiveManifest {
            archive_version: ARCHIVE_VERSION,
        })?;
        write_bytes(&mut writer, &mut budget, MANIFEST_FILE, &manifest)?;
        write_bytes(&mut writer, &mut budget, "project/meta.json", &meta_bytes)?;
        let meta: ProjectMeta = serde_json::from_slice(&meta_bytes)?;
        write_bytes(
            &mut writer,
            &mut budget,
            "project/family.json",
            &family_bytes,
        )?;

        for subdir in ["photos", "thumbs"] {
            for path in media_files(&root, subdir)? {
                let file_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| CmdError::InvalidPath(path.display().to_string()))?;
                write_file(
                    &mut writer,
                    &mut budget,
                    &format!("project/media/{}/{}", subdir, file_name),
                    &path,
                )?;
            }
        }
        let file = writer.finish()?;
        validate_archive_size(file.metadata()?.len())?;
        Ok(meta)
    })();

    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn allowed_directory(path: &Path) -> bool {
    matches!(
        path.to_string_lossy().trim_end_matches('/'),
        "project" | "project/media" | "project/media/photos" | "project/media/thumbs"
    )
}

fn max_entry_size(path: &Path) -> Option<u64> {
    let value = path.to_string_lossy();
    match value.as_ref() {
        MANIFEST_FILE | "project/meta.json" => Some(1024 * 1024),
        "project/family.json" => Some(MAX_JSON_BYTES),
        _ if is_allowed_media_file(path) => Some(MAX_MEDIA_BYTES),
        _ => None,
    }
}

fn is_allowed_media_file(path: &Path) -> bool {
    let components: Vec<_> = path.iter().collect();
    components.len() == 4
        && components[0] == "project"
        && components[1] == "media"
        && (components[2] == "photos" || components[2] == "thumbs")
        && validate_photo_file_name(path).is_ok()
}

fn extract_bundle(archive_path: &Path, extraction_root: &Path) -> CmdResult<PathBuf> {
    let archive_size = fs::metadata(archive_path)?.len();
    validate_archive_size(archive_size)?;

    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;
    validate_entry_count(archive.len())?;

    let mut seen = HashSet::new();
    let mut budget = BundleBudget::default();
    fs::create_dir_all(extraction_root)?;

    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if entry.is_symlink() {
            return Err(CmdError::Other("备份包不允许包含符号链接".into()));
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| CmdError::Other("备份包包含越界路径".into()))?;
        let normalized = enclosed.to_string_lossy().replace('\\', "/");
        if !seen.insert(normalized.clone()) {
            return Err(CmdError::Other(format!(
                "备份包包含重复条目：{}",
                normalized
            )));
        }

        if entry.is_dir() {
            if !allowed_directory(&enclosed) {
                return Err(CmdError::Other(format!(
                    "备份包包含未知目录：{}",
                    normalized
                )));
            }
            fs::create_dir_all(extraction_root.join(&enclosed))?;
            continue;
        }

        let max_size = budget.include_file(&enclosed, entry.size())?;

        let output_path = extraction_root.join(&enclosed);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = File::create(&output_path)?;
        let expected = entry.size();
        let copied = io::copy(&mut entry.take(max_size + 1), &mut output)?;
        if copied != expected {
            return Err(CmdError::Other(format!(
                "备份包条目大小不一致：{}",
                normalized
            )));
        }
    }

    let manifest_bytes = fs::read(extraction_root.join(MANIFEST_FILE))?;
    let manifest: ArchiveManifest = serde_json::from_slice(&manifest_bytes)?;
    if manifest.archive_version != ARCHIVE_VERSION {
        return Err(CmdError::Other(format!(
            "不支持的备份包版本：{}",
            manifest.archive_version
        )));
    }

    let project_root = extraction_root.join(PROJECT_PREFIX);
    validate_project_root_path(&project_root)?;
    let meta: ProjectMeta = serde_json::from_slice(&fs::read(project_root.join(META_FILE))?)?;
    if u64::from(meta.schema_version) > CURRENT_SCHEMA_VERSION {
        return Err(CmdError::Other("备份包项目版本高于当前应用".into()));
    }
    let family: serde_json::Value =
        serde_json::from_slice(&fs::read(project_root.join(FAMILY_FILE))?)?;
    let schema_version = family
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| CmdError::CorruptedProject("family.json 缺少 schemaVersion".into()))?;
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err(CmdError::Other("备份包数据版本高于当前应用".into()));
    }
    Ok(project_root)
}

fn import_bundle_at(archive_path: &Path, managed_base: &Path) -> CmdResult<ManagedProjectSummary> {
    fs::create_dir_all(managed_base)?;
    let id = uuid::Uuid::new_v4().to_string();
    let staging = managed_base.join(format!(".importing-{}", id));
    let destination = managed_project_root(managed_base, &id)?;

    let result = (|| -> CmdResult<ManagedProjectSummary> {
        let extracted_project = extract_bundle(archive_path, &staging)?;
        let meta: ProjectMeta =
            serde_json::from_slice(&fs::read(extracted_project.join(META_FILE))?)?;
        if destination.exists() {
            return Err(CmdError::Other("导入目标项目已存在".into()));
        }
        fs::rename(&extracted_project, &destination)?;
        Ok(ManagedProjectSummary {
            project: ProjectRef::Managed { id },
            meta,
        })
    })();

    let _ = fs::remove_dir_all(&staging);
    result
}

fn sanitize_suggested_name(name: &str) -> String {
    let mut sanitized: String = name
        .chars()
        .filter(|value| !value.is_control())
        .map(|value| match value {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .take(80)
        .collect();
    if sanitized.trim().is_empty() {
        sanitized = "家族备份".into();
    }
    format!("{}{}", sanitized.trim(), BUNDLE_SUFFIX)
}

#[tauri::command]
pub fn export_project_bundle(app: AppHandle, project: ProjectRef) -> CmdResult<BundleExport> {
    let root = resolve_project_root(&app, &project)?;
    let name = transfer_name();
    let destination = transfer_path(&app, &name)?;
    let meta = export_bundle_at(&root, &destination)?;
    Ok(BundleExport {
        transfer_name: name,
        suggested_name: sanitize_suggested_name(&meta.name),
    })
}

#[tauri::command]
pub fn import_project_bundle(
    app: AppHandle,
    transfer_name: String,
) -> CmdResult<ManagedProjectSummary> {
    let archive_path = transfer_path(&app, &transfer_name)?;
    let managed_base = managed_projects_dir(&app)?;
    import_bundle_at(&archive_path, &managed_base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{initialize_project, save_project_at};

    fn tmp_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "family_bundle_test_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        path
    }

    fn source_project(name: &str) -> PathBuf {
        let root = tmp_dir(name);
        fs::create_dir_all(&root).unwrap();
        initialize_project(&root, "测试家族").unwrap();
        save_project_at(
            &root,
            r#"{"schemaVersion":4,"members":{},"nicknameOverrides":{}}"#,
        )
        .unwrap();
        fs::write(root.join("media/photos/photo-1.webp"), b"photo").unwrap();
        fs::write(root.join("media/thumbs/photo-1.webp"), b"thumb").unwrap();
        root
    }

    #[test]
    fn bundle_roundtrip_preserves_project_and_media() {
        let source = source_project("roundtrip-source");
        let archive = tmp_dir("roundtrip-archive").with_extension("familybundle");
        let managed_base = tmp_dir("roundtrip-managed");

        export_bundle_at(&source, &archive).unwrap();
        let imported = import_bundle_at(&archive, &managed_base).unwrap();
        let ProjectRef::Managed { id } = imported.project else {
            panic!("expected managed project")
        };
        let imported_root = managed_project_root(&managed_base, &id).unwrap();

        assert!(imported_root.join(FAMILY_FILE).is_file());
        assert_eq!(
            fs::read(imported_root.join("media/photos/photo-1.webp")).unwrap(),
            b"photo"
        );
        assert_eq!(imported.meta.name, "测试家族");

        fs::remove_dir_all(source).ok();
        fs::remove_file(archive).ok();
        fs::remove_dir_all(managed_base).ok();
    }

    #[test]
    fn export_rejects_too_many_media_entries_and_cleans_output() {
        let source = source_project("entry-limit");
        let archive = tmp_dir("entry-limit-archive").with_extension("familybundle");
        for index in 2..=2_500 {
            for subdir in ["photos", "thumbs"] {
                fs::write(
                    source.join(format!("media/{}/photo-{}.webp", subdir, index)),
                    b"photo",
                )
                .unwrap();
            }
        }

        let result = export_bundle_at(&source, &archive);
        let output_exists = archive.exists();
        fs::remove_dir_all(source).ok();
        fs::remove_file(archive).ok();

        assert!(result.unwrap_err().to_string().contains("5000"));
        assert!(!output_exists);
    }

    #[test]
    fn export_rejects_metadata_above_import_limit_and_cleans_output() {
        let source = source_project("meta-limit");
        let archive = tmp_dir("meta-limit-archive").with_extension("familybundle");
        let mut meta = fs::read(source.join(META_FILE)).unwrap();
        // 补空白仍是合法 JSON，用于验证导入的 1 MiB 元数据限制。
        meta.resize(1024 * 1024 + 1, b' ');
        fs::write(source.join(META_FILE), meta).unwrap();

        let result = export_bundle_at(&source, &archive);
        let output_exists = archive.exists();
        fs::remove_dir_all(source).ok();
        fs::remove_file(archive).ok();

        assert!(result.unwrap_err().to_string().contains("条目过大"));
        assert!(!output_exists);
    }

    #[test]
    fn export_metadata_at_import_limit_roundtrips() {
        let source = source_project("meta-boundary");
        let archive = tmp_dir("meta-boundary-archive").with_extension("familybundle");
        let managed_base = tmp_dir("meta-boundary-managed");
        let mut meta = fs::read(source.join(META_FILE)).unwrap();
        meta.resize(1024 * 1024, b' ');
        fs::write(source.join(META_FILE), meta).unwrap();

        export_bundle_at(&source, &archive).unwrap();
        let imported = import_bundle_at(&archive, &managed_base).unwrap();
        assert_eq!(imported.meta.name, "测试家族");

        fs::remove_dir_all(source).ok();
        fs::remove_file(archive).ok();
        fs::remove_dir_all(managed_base).ok();
    }

    #[test]
    fn bundle_budget_accepts_total_limit_and_rejects_next_byte() {
        let mut budget = BundleBudget::default();
        let full_files = MAX_EXTRACTED_BYTES / MAX_MEDIA_BYTES;
        for index in 0..full_files {
            budget
                .include_file(
                    Path::new(&format!("project/media/photos/photo-{}.webp", index)),
                    MAX_MEDIA_BYTES,
                )
                .unwrap();
        }
        budget
            .include_file(
                Path::new("project/media/photos/final.webp"),
                MAX_EXTRACTED_BYTES % MAX_MEDIA_BYTES,
            )
            .unwrap();

        let error = budget
            .include_file(Path::new("project/media/photos/overflow.webp"), 1)
            .unwrap_err();
        assert!(error.to_string().contains("1 GiB"));
    }

    #[test]
    fn bundle_budget_applies_each_import_entry_limit() {
        for (path, limit) in [
            (MANIFEST_FILE, 1024 * 1024),
            ("project/meta.json", 1024 * 1024),
            ("project/family.json", MAX_JSON_BYTES),
            ("project/media/photos/photo.webp", MAX_MEDIA_BYTES),
            ("project/media/thumbs/photo.webp", MAX_MEDIA_BYTES),
        ] {
            let mut budget = BundleBudget::default();
            budget.include_file(Path::new(path), limit).unwrap();
            let error = budget.include_file(Path::new(path), limit + 1).unwrap_err();
            assert!(error.to_string().contains("条目过大"), "{}", path);
        }
    }

    #[test]
    fn import_rejects_oversized_archive_before_extraction() {
        let archive = tmp_dir("archive-size").with_extension("familybundle");
        let extraction = tmp_dir("archive-size-extraction");
        File::create(&archive)
            .unwrap()
            .set_len(MAX_ARCHIVE_BYTES + 1)
            .unwrap();

        let error = extract_bundle(&archive, &extraction).unwrap_err();
        fs::remove_file(archive).ok();

        assert!(error.to_string().contains("512 MiB"));
        assert!(!extraction.exists());
    }

    #[test]
    fn import_rejects_path_traversal() {
        let archive_path = tmp_dir("traversal").with_extension("familybundle");
        let file = File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("../escape", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"escape").unwrap();
        writer.finish().unwrap();
        let managed_base = tmp_dir("traversal-managed");

        let error = import_bundle_at(&archive_path, &managed_base).unwrap_err();

        assert!(error.to_string().contains("越界路径"));
        assert!(!managed_base.parent().unwrap().join("escape").exists());
        fs::remove_file(archive_path).ok();
        fs::remove_dir_all(managed_base).ok();
    }

    #[test]
    fn import_rejects_unknown_entries() {
        let archive_path = tmp_dir("unknown").with_extension("familybundle");
        let file = File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("unexpected.txt", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"unexpected").unwrap();
        writer.finish().unwrap();

        let error = import_bundle_at(&archive_path, &tmp_dir("unknown-managed")).unwrap_err();

        assert!(error.to_string().contains("未知文件"));
        fs::remove_file(archive_path).ok();
    }

    #[test]
    fn transfer_names_cannot_escape_app_cache() {
        assert!(validate_transfer_name("../escape.familybundle").is_err());
        assert!(validate_transfer_name("not-a-uuid.familybundle").is_err());
        assert!(validate_transfer_name(&transfer_name()).is_ok());
    }
}

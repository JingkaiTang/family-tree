use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::GenericImageView;
use serde::Serialize;

use crate::errors::{CmdError, CmdResult};

const MEDIA_DIR: &str = "media";
const PHOTOS_SUBDIR: &str = "photos";
const THUMBS_SUBDIR: &str = "thumbs";
const TRASH_SUBDIR: &str = ".trash";

const MAX_DIM: u32 = 1600;
const THUMB_DIM: u32 = 256;
const WEBP_QUALITY: f32 = 80.0;
const THUMB_WEBP_QUALITY: f32 = 70.0;

#[derive(Debug, Serialize)]
pub struct ImportedPhoto {
    #[serde(rename = "photoId")]
    pub photo_id: String,
}

fn validate_root(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(CmdError::InvalidPath(format!(
            "路径必须为绝对路径：{}",
            path
        )));
    }
    if !p.exists() {
        return Err(CmdError::InvalidPath(format!(
            "项目目录不存在：{}",
            p.display()
        )));
    }
    Ok(p)
}

fn ensure_media_dirs(root: &Path) -> CmdResult<()> {
    fs::create_dir_all(root.join(MEDIA_DIR).join(PHOTOS_SUBDIR))?;
    fs::create_dir_all(root.join(MEDIA_DIR).join(THUMBS_SUBDIR))?;
    fs::create_dir_all(root.join(TRASH_SUBDIR))?;
    Ok(())
}

/// 限制某一边最大为 max_dim 的同比例缩放。若原图更小则不放大。
fn clamp_dim(w: u32, h: u32, max_dim: u32) -> (u32, u32) {
    if w <= max_dim && h <= max_dim {
        return (w, h);
    }
    let ratio = (max_dim as f32) / (w.max(h) as f32);
    let nw = ((w as f32) * ratio).round().max(1.0) as u32;
    let nh = ((h as f32) * ratio).round().max(1.0) as u32;
    (nw, nh)
}

/// 把一张图压成 webp 写入指定路径。
fn encode_and_write_webp(
    src: &image::DynamicImage,
    dest: &Path,
    quality: f32,
) -> CmdResult<()> {
    // 转 RGBA8 → webp encoder
    let rgba = src.to_rgba8();
    let (w, h) = rgba.dimensions();
    let encoder = webp::Encoder::from_rgba(&rgba, w, h);
    let encoded = encoder.encode(quality);
    fs::create_dir_all(
        dest.parent()
            .ok_or_else(|| CmdError::InvalidPath(dest.display().to_string()))?,
    )?;
    let bytes: &[u8] = &encoded;
    fs::write(dest, bytes)?;
    Ok(())
}

#[tauri::command]
pub fn import_photo(
    project_path: String,
    bytes: Vec<u8>,
    _mime: String,
) -> CmdResult<ImportedPhoto> {
    let root = validate_root(&project_path)?;
    ensure_media_dirs(&root)?;

    // 解码（任意格式 image crate 支持的）
    let img = image::load_from_memory(&bytes)
        .map_err(|e| CmdError::Other(format!("图片解码失败：{}", e)))?;

    // 原图：按最长边 MAX_DIM 缩放
    let (w, h) = img.dimensions();
    let (nw, nh) = clamp_dim(w, h, MAX_DIM);
    let full = if (nw, nh) == (w, h) {
        img.clone()
    } else {
        img.resize(nw, nh, FilterType::Lanczos3)
    };

    // 缩略图：按最长边 THUMB_DIM 缩放（从原图缩，保真）
    let (tw, th) = clamp_dim(w, h, THUMB_DIM);
    let thumb = img.resize(tw, th, FilterType::Lanczos3);
    // 抑制未使用警告（load_from_memory 返回就够了）
    let _ = Cursor::new(&bytes);

    // 分配一个 UUID，写入两处
    let photo_id = uuid::Uuid::new_v4().to_string();
    let photo_path = root
        .join(MEDIA_DIR)
        .join(PHOTOS_SUBDIR)
        .join(format!("{}.webp", photo_id));
    let thumb_path = root
        .join(MEDIA_DIR)
        .join(THUMBS_SUBDIR)
        .join(format!("{}.webp", photo_id));

    encode_and_write_webp(&full, &photo_path, WEBP_QUALITY)?;
    encode_and_write_webp(&thumb, &thumb_path, THUMB_WEBP_QUALITY)?;

    Ok(ImportedPhoto { photo_id })
}

/// 立即把指定 photoId 文件移入 .trash/（软删除）
#[tauri::command]
pub fn delete_photo(project_path: String, photo_id: String) -> CmdResult<()> {
    let root = validate_root(&project_path)?;
    ensure_media_dirs(&root)?;
    move_to_trash(&root, &photo_id)?;
    Ok(())
}

/// 扫描 media/photos 与 media/thumbs 下所有 webp，移除不在 used_ids 里的文件到 .trash/。
/// 返回被清理的照片数（每个 id 计 1，即使两张文件）。
#[tauri::command]
pub fn gc_media(project_path: String, used_ids: Vec<String>) -> CmdResult<u32> {
    let root = validate_root(&project_path)?;
    ensure_media_dirs(&root)?;

    let used: std::collections::HashSet<String> = used_ids.into_iter().collect();
    let photos_dir = root.join(MEDIA_DIR).join(PHOTOS_SUBDIR);
    let mut trashed = 0u32;

    if let Ok(entries) = fs::read_dir(&photos_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                if p.extension().and_then(|s| s.to_str()) == Some("webp") && !used.contains(stem) {
                    move_to_trash(&root, stem)?;
                    trashed += 1;
                }
            }
        }
    }
    Ok(trashed)
}

fn move_to_trash(root: &Path, photo_id: &str) -> CmdResult<()> {
    let trash_dir = root.join(TRASH_SUBDIR);
    fs::create_dir_all(&trash_dir)?;

    let photo = root
        .join(MEDIA_DIR)
        .join(PHOTOS_SUBDIR)
        .join(format!("{}.webp", photo_id));
    let thumb = root
        .join(MEDIA_DIR)
        .join(THUMBS_SUBDIR)
        .join(format!("{}.webp", photo_id));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    for (src, kind) in [(photo, "photo"), (thumb, "thumb")] {
        if src.exists() {
            let dest = trash_dir.join(format!("{}_{}_{}.webp", now, kind, photo_id));
            let _ = fs::rename(&src, &dest);
        }
    }
    Ok(())
}

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
        p.push(format!("family_tree_media_test_{}_{}", name, stamp));
        p
    }

    /// 生成一个 32x32 的 PNG 字节流（单色），作为合法输入
    fn tiny_png_bytes() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(32, 32, image::Rgb([120u8, 180, 220]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    #[test]
    fn import_creates_photo_and_thumb() {
        let root = tmp_dir("import");
        fs::create_dir_all(&root).unwrap();
        let root_s = root.to_string_lossy().to_string();
        let bytes = tiny_png_bytes();

        let res = import_photo(root_s.clone(), bytes, "image/png".into()).expect("import");
        assert!(!res.photo_id.is_empty());

        let photo = root
            .join(MEDIA_DIR)
            .join(PHOTOS_SUBDIR)
            .join(format!("{}.webp", res.photo_id));
        let thumb = root
            .join(MEDIA_DIR)
            .join(THUMBS_SUBDIR)
            .join(format!("{}.webp", res.photo_id));
        assert!(photo.exists());
        assert!(thumb.exists());
        assert!(photo.metadata().unwrap().len() > 0);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn gc_moves_unused_to_trash() {
        let root = tmp_dir("gc");
        fs::create_dir_all(&root).unwrap();
        let root_s = root.to_string_lossy().to_string();
        let bytes = tiny_png_bytes();

        let a = import_photo(root_s.clone(), bytes.clone(), "image/png".into()).unwrap();
        let b = import_photo(root_s.clone(), bytes, "image/png".into()).unwrap();

        // 仅 a 被使用，b 应被 GC
        let n = gc_media(root_s.clone(), vec![a.photo_id.clone()]).unwrap();
        assert_eq!(n, 1);

        assert!(root
            .join(MEDIA_DIR)
            .join(PHOTOS_SUBDIR)
            .join(format!("{}.webp", a.photo_id))
            .exists());
        assert!(!root
            .join(MEDIA_DIR)
            .join(PHOTOS_SUBDIR)
            .join(format!("{}.webp", b.photo_id))
            .exists());

        // .trash/ 里应有对应文件
        let trash = root.join(TRASH_SUBDIR);
        let has_b_in_trash = fs::read_dir(&trash)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().contains(&b.photo_id));
        assert!(has_b_in_trash);

        fs::remove_dir_all(&root).ok();
    }
}

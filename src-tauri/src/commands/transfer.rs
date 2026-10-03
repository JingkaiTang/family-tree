use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FileAccessMode, FilePath, PickerMode};
use tauri_plugin_fs::{FsExt, OpenOptions};

use super::bundle::{
    export_project_bundle, import_project_bundle, transfer_path, MAX_ARCHIVE_BYTES,
};
use super::project::{ManagedProjectSummary, ProjectRef};
use crate::errors::{CmdError, CmdResult};

const BUNDLE_EXTENSION: &str = "familybundle";
const TRANSFER_BUFFER_BYTES: usize = 64 * 1024;

/// Native dialogs return the selected handle without granting WebView fs scope.
/// Their blocking APIs must run off the UI thread that presents the dialog.
#[tauri::command]
pub async fn pick_project_directory(
    app: AppHandle,
    title: String,
) -> CmdResult<Option<ProjectRef>> {
    #[cfg(mobile)]
    {
        let _ = (app, title);
        Err(CmdError::InvalidPath(
            "移动端仅允许 AppData 托管项目".into(),
        ))
    }
    #[cfg(desktop)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let selected = app.dialog().file().set_title(title).blocking_pick_folder();
            selected_directory_project(selected)
        })
        .await
        .map_err(|error| CmdError::Other(format!("目录选择失败：{}", error)))?
    }
}

#[cfg(desktop)]
fn selected_directory_project(selected: Option<FilePath>) -> CmdResult<Option<ProjectRef>> {
    selected
        .map(|selected| {
            let path = selected
                .into_path()
                .map_err(|error| CmdError::InvalidPath(error.to_string()))?;
            let path = fs::canonicalize(path)?;
            if !path.is_dir() {
                return Err(CmdError::InvalidPath("所选位置不是目录".into()));
            }
            let path = path
                .to_str()
                .ok_or_else(|| CmdError::InvalidPath("目录路径不是有效 UTF-8".into()))?
                .to_owned();
            Ok(ProjectRef::External { path })
        })
        .transpose()
}

struct CachedBundle(PathBuf);

impl Drop for CachedBundle {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(target_os = "ios")]
struct ScopedFileAccess<'a> {
    app: &'a AppHandle,
    path: &'a FilePath,
}

#[cfg(target_os = "ios")]
impl Drop for ScopedFileAccess<'_> {
    fn drop(&mut self) {
        let _ = self
            .app
            .fs()
            .stop_accessing_security_scoped_resource(self.path.clone());
    }
}

fn with_selected_file<T>(
    app: &AppHandle,
    selected: FilePath,
    options: OpenOptions,
    operation: impl FnOnce(&mut File) -> CmdResult<T>,
) -> CmdResult<T> {
    // FsExt starts iOS security-scoped access when opening the selected URL.
    // Declare its guard first so the file closes before access is released.
    #[cfg(target_os = "ios")]
    let _access = match &selected {
        FilePath::Url(url) if url.scheme() == "file" => Some(ScopedFileAccess {
            app,
            path: &selected,
        }),
        _ => None,
    };
    // Preserve FilePath URLs: Android content URIs are not filesystem paths.
    let mut file = app.fs().open(selected.clone(), options)?;
    operation(&mut file)
}

fn copy_bundle(
    source: &mut impl Read,
    destination: &mut impl Write,
    max_bytes: u64,
) -> CmdResult<()> {
    let mut buffer = [0; TRANSFER_BUFFER_BYTES];
    let mut remaining = max_bytes;
    loop {
        // Read at most one byte beyond the limit, even for an unbounded source.
        let capacity = (buffer.len() as u64).min(remaining.saturating_add(1)) as usize;
        let count = match source.read(&mut buffer[..capacity]) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            destination.flush()?;
            return Ok(());
        }
        if count as u64 > remaining {
            return Err(CmdError::Other("备份包超过 512 MiB 限制".into()));
        }
        destination.write_all(&buffer[..count])?;
        remaining -= count as u64;
    }
}

#[tauri::command]
pub async fn import_project_bundle_from_picker(
    app: AppHandle,
) -> CmdResult<Option<ManagedProjectSummary>> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("家族备份", &[BUNDLE_EXTENSION])
            .set_picker_mode(PickerMode::Document)
            .set_file_access_mode(FileAccessMode::Scoped)
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };

        let name = format!("{}.{}", uuid::Uuid::new_v4(), BUNDLE_EXTENSION);
        let cache = CachedBundle(transfer_path(&app, &name)?);
        let parent = cache
            .0
            .parent()
            .ok_or_else(|| CmdError::InvalidPath("传输文件缺少缓存目录".into()))?;
        fs::create_dir_all(parent)?;
        let mut options = OpenOptions::new();
        options.read(true);
        with_selected_file(&app, selected, options, |source| {
            let mut destination = File::options()
                .write(true)
                .create_new(true)
                .open(&cache.0)?;
            copy_bundle(source, &mut destination, MAX_ARCHIVE_BYTES)
        })?;
        import_project_bundle(app, name).map(Some)
    })
    .await
    .map_err(|error| CmdError::Other(format!("备份导入失败：{}", error)))?
}

#[tauri::command]
pub async fn export_project_bundle_to_picker(
    app: AppHandle,
    project: ProjectRef,
) -> CmdResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let generated = export_project_bundle(app.clone(), project)?;
        let cache = CachedBundle(transfer_path(&app, &generated.transfer_name)?);
        let selected = app
            .dialog()
            .file()
            .add_filter("家族备份", &[BUNDLE_EXTENSION])
            .set_file_name(generated.suggested_name)
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };

        let mut source = File::open(&cache.0)?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        with_selected_file(&app, selected, options, |destination| {
            copy_bundle(&mut source, destination, MAX_ARCHIVE_BYTES)
        })?;
        Ok(true)
    })
    .await
    .map_err(|error| CmdError::Other(format!("备份导出失败：{}", error)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, ErrorKind};

    struct TestReader<'a> {
        remaining: &'a [u8],
        max_chunk: usize,
        interrupt_once: bool,
        failure_after_data: Option<ErrorKind>,
    }

    impl<'a> TestReader<'a> {
        fn new(bytes: &'a [u8]) -> Self {
            Self {
                remaining: bytes,
                max_chunk: usize::MAX,
                interrupt_once: false,
                failure_after_data: None,
            }
        }
    }

    impl Read for TestReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if std::mem::take(&mut self.interrupt_once) {
                return Err(io::Error::from(ErrorKind::Interrupted));
            }
            if self.remaining.is_empty() {
                if let Some(kind) = self.failure_after_data {
                    return Err(io::Error::from(kind));
                }
            }
            let count = buffer.len().min(self.max_chunk);
            self.remaining.read(&mut buffer[..count])
        }
    }

    struct TestWriter {
        bytes: Vec<u8>,
        max_chunk: usize,
        interrupt_once: bool,
        write_error: Option<ErrorKind>,
        flush_error: Option<ErrorKind>,
        flush_count: usize,
    }

    impl TestWriter {
        fn new(max_chunk: usize) -> Self {
            Self {
                bytes: Vec::new(),
                max_chunk,
                interrupt_once: false,
                write_error: None,
                flush_error: None,
                flush_count: 0,
            }
        }
    }

    impl Write for TestWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if std::mem::take(&mut self.interrupt_once) {
                return Err(io::Error::from(ErrorKind::Interrupted));
            }
            if let Some(kind) = self.write_error {
                return Err(io::Error::from(kind));
            }
            let count = buffer.len().min(self.max_chunk);
            self.bytes.extend_from_slice(&buffer[..count]);
            Ok(count)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.flush_count += 1;
            match self.flush_error {
                Some(kind) => Err(io::Error::from(kind)),
                None => Ok(()),
            }
        }
    }

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("family_transfer_test_{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn assert_io_error(error: CmdError, expected: ErrorKind) {
        match error {
            CmdError::Io(error) => assert_eq!(error.kind(), expected),
            error => panic!("expected {expected:?} IO error, got {error}"),
        }
    }

    #[test]
    fn copy_preserves_bytes_across_buffer_boundaries_and_flushes() {
        let bytes: Vec<u8> = (0..TRANSFER_BUFFER_BYTES * 2 + 19)
            .map(|index| (index % 256) as u8)
            .collect();
        let mut source = bytes.as_slice();
        let mut destination = TestWriter::new(usize::MAX);

        copy_bundle(&mut source, &mut destination, bytes.len() as u64).unwrap();

        assert_eq!(destination.bytes, bytes);
        assert_eq!(destination.flush_count, 1);
    }

    #[test]
    fn copy_completes_short_reads_and_short_writes() {
        let bytes = b"fictional bundle bytes\0\xff\x01";
        let mut source = TestReader::new(bytes);
        source.max_chunk = 3;
        let mut destination = TestWriter::new(2);

        copy_bundle(&mut source, &mut destination, bytes.len() as u64).unwrap();

        assert_eq!(destination.bytes, bytes);
        assert_eq!(destination.flush_count, 1);
    }

    #[test]
    fn copy_retries_interrupted_reads_and_writes() {
        let bytes = b"fictional bundle";
        let mut source = TestReader::new(bytes);
        source.interrupt_once = true;
        let mut destination = TestWriter::new(usize::MAX);
        destination.interrupt_once = true;

        copy_bundle(&mut source, &mut destination, bytes.len() as u64).unwrap();

        assert_eq!(destination.bytes, bytes);
        assert_eq!(destination.flush_count, 1);
    }

    #[test]
    fn copy_accepts_empty_input_with_zero_budget() {
        let mut source = io::empty();
        let mut destination = TestWriter::new(usize::MAX);

        copy_bundle(&mut source, &mut destination, 0).unwrap();

        assert!(destination.bytes.is_empty());
        assert_eq!(destination.flush_count, 1);
    }

    #[test]
    fn copy_propagates_read_failure_after_partial_data() {
        let bytes = b"partial fictional bundle";
        let mut source = TestReader::new(bytes);
        source.failure_after_data = Some(ErrorKind::PermissionDenied);
        let mut destination = TestWriter::new(usize::MAX);

        let error = copy_bundle(&mut source, &mut destination, 100).unwrap_err();

        assert_io_error(error, ErrorKind::PermissionDenied);
        assert_eq!(destination.bytes, bytes);
        assert_eq!(destination.flush_count, 0);
    }

    #[test]
    fn copy_propagates_write_failure() {
        let mut source = b"fictional bundle".as_slice();
        let mut destination = TestWriter::new(usize::MAX);
        destination.write_error = Some(ErrorKind::BrokenPipe);

        let error = copy_bundle(&mut source, &mut destination, 100).unwrap_err();

        assert_io_error(error, ErrorKind::BrokenPipe);
        assert_eq!(destination.flush_count, 0);
    }

    #[test]
    fn copy_propagates_flush_failure() {
        let bytes = b"fictional bundle";
        let mut source = bytes.as_slice();
        let mut destination = TestWriter::new(usize::MAX);
        destination.flush_error = Some(ErrorKind::Other);

        let error = copy_bundle(&mut source, &mut destination, 100).unwrap_err();

        assert_io_error(error, ErrorKind::Other);
        assert_eq!(destination.bytes, bytes);
        assert_eq!(destination.flush_count, 1);
    }

    #[test]
    fn copy_rejects_zero_byte_writes() {
        let mut source = b"fictional bundle".as_slice();
        let mut destination = TestWriter::new(0);

        let error = copy_bundle(&mut source, &mut destination, 100).unwrap_err();

        assert_io_error(error, ErrorKind::WriteZero);
        assert!(destination.bytes.is_empty());
        assert_eq!(destination.flush_count, 0);
    }

    #[test]
    fn copy_reads_only_limit_plus_one_from_an_unbounded_source() {
        struct UnboundedSource {
            bytes_read: u64,
            stop_after: u64,
        }

        impl Read for UnboundedSource {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                assert!(buffer.len() <= TRANSFER_BUFFER_BYTES);
                self.bytes_read += buffer.len() as u64;
                // Fail promptly instead of allowing a regression to loop forever.
                assert!(self.bytes_read <= self.stop_after);
                buffer.fill(0x5a);
                Ok(buffer.len())
            }
        }

        for limit in [
            0,
            7,
            TRANSFER_BUFFER_BYTES as u64,
            2 * TRANSFER_BUFFER_BYTES as u64 + 17,
        ] {
            let mut source = UnboundedSource {
                bytes_read: 0,
                stop_after: limit + 1,
            };
            let mut destination = TestWriter::new(usize::MAX);

            let error = copy_bundle(&mut source, &mut destination, limit).unwrap_err();

            assert!(error.to_string().contains("512 MiB"));
            assert_eq!(source.bytes_read, limit + 1);
            assert!(destination.bytes.len() as u64 <= limit);
            assert!(destination.bytes.iter().all(|byte| *byte == 0x5a));
            assert_eq!(destination.flush_count, 0);
        }
    }

    #[test]
    fn cached_bundle_is_removed_after_success() {
        let directory = TempDirectory::new();
        let path = directory.0.join("success.familybundle");

        let result = (|| -> CmdResult<()> {
            let cache = CachedBundle(path.clone());
            let mut destination = File::create(&cache.0)?;
            copy_bundle(&mut b"fictional bundle".as_slice(), &mut destination, 100)?;
            assert!(path.is_file());
            Ok(())
        })();

        result.unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn cached_bundle_is_removed_after_copy_error() {
        let directory = TempDirectory::new();
        let path = directory.0.join("failed.familybundle");

        let result = (|| -> CmdResult<()> {
            let cache = CachedBundle(path.clone());
            let mut destination = File::create(&cache.0)?;
            let mut source = TestReader::new(b"partial fictional bundle");
            source.failure_after_data = Some(ErrorKind::PermissionDenied);
            copy_bundle(&mut source, &mut destination, 100)?;
            Ok(())
        })();

        assert_io_error(result.unwrap_err(), ErrorKind::PermissionDenied);
        assert!(!path.exists());
    }

    #[cfg(desktop)]
    #[test]
    fn directory_picker_cancellation_returns_none() {
        assert_eq!(selected_directory_project(None).unwrap(), None);
    }

    #[cfg(desktop)]
    #[test]
    fn directory_picker_returns_a_canonical_external_reference() {
        let directory = TempDirectory::new();
        let selected = FilePath::Path(directory.0.join("."));

        let project = selected_directory_project(Some(selected)).unwrap();

        assert_eq!(
            project,
            Some(ProjectRef::External {
                path: fs::canonicalize(&directory.0)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned(),
            })
        );
    }

    #[cfg(desktop)]
    #[test]
    fn directory_picker_rejects_a_regular_file() {
        let directory = TempDirectory::new();
        let file = directory.0.join("fictional.txt");
        fs::write(&file, b"fictional data").unwrap();

        let result = selected_directory_project(Some(FilePath::Path(file)));

        assert!(matches!(result, Err(CmdError::InvalidPath(_))));
    }

    #[cfg(all(desktop, unix))]
    #[test]
    fn directory_picker_rejects_non_utf8_paths() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let directory = TempDirectory::new();
        let path = directory
            .0
            .join(OsString::from_vec(b"fictional-\xff".to_vec()));
        fs::create_dir(&path).unwrap();

        let result = selected_directory_project(Some(FilePath::Path(path)));

        assert!(matches!(result, Err(CmdError::InvalidPath(_))));
    }

    #[test]
    fn default_capability_does_not_grant_webview_filesystem_access() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();

        for permission in permissions {
            let identifier = permission
                .as_str()
                .or_else(|| {
                    permission
                        .get("identifier")
                        .and_then(serde_json::Value::as_str)
                })
                .expect("permission must have an identifier");
            assert!(
                !identifier.starts_with("fs:"),
                "WebView must not receive generic filesystem permission: {identifier}"
            );
        }
    }
}

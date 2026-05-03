use serde::Serialize;

/// 统一的命令错误类型。前端会收到字符串消息。
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error("I/O 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("无效路径: {0}")]
    InvalidPath(String),

    #[error("项目结构损坏: {0}")]
    CorruptedProject(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for CmdError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

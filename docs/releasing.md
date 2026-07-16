# 发布前置

项目当前只达到可公开协作的 alpha 基线：仓库没有自动发布工作流，也不保存签名证书、私钥或公证凭据。首次向普通用户分发二进制之前，应先完成本页清单。

## 发布边界

- 分别在受信任的 macOS、Windows 和 Linux runner 上构建对应平台产物；不要把未经验证的跨平台交叉编译产物作为正式版本。
- 版本号应同步到 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`，并从 `CHANGELOG.md` 的 Unreleased 生成发布说明。
- 发布工作流只能由受保护的 tag 或手工审批触发，默认 `contents: read`，仅上传 Release 的 job 获得最小写权限。
- 发布前重复执行 CI 的测试、构建、性能和依赖审计，并保存产物校验和；正式发布不得复用开发机上来源不明的构建产物。

## 平台签名凭据

以下内容只能保存在平台密钥库或 GitHub Encrypted Secrets 中，不得写入仓库、Issue、日志或测试 fixture：

- **macOS**：Apple Developer ID Application 签名身份，以及 App Store Connect API 密钥或 Apple 公证凭据。正式分发前完成签名、notarization 和 stapling，参见 [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)。
- **Windows**：受信任的代码签名证书和访问密码，或外部/HSM/Azure Artifact Signing 凭据。证书私钥不应以明文落盘，参见 [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/)。
- **自动更新**：当前未启用。若未来启用 Tauri updater，先设计密钥轮换与离线备份；私钥仅供发布 job 使用，仓库只存公钥。Tauri 要求更新包签名且不能关闭验证，参见 [Tauri updater](https://v2.tauri.app/plugin/updater/)。

## 首次正式发布门槛

1. 在三平台完成安装、首次启动、创建/打开/保存项目、照片导入和备份恢复冒烟测试。
2. 验证 macOS 与 Windows 签名、公证或 SmartScreen 行为，并从干净系统安装发布候选包。
3. 确认 `SECURITY.md` 中存在可用的私密报告入口，仓库已启用分支保护、Dependabot 和 secret scanning。
4. 生成校验和和软件物料清单（SBOM），记录构建提交、runner 和依赖锁文件。
5. 先发布 prerelease，确认没有数据损坏、崩溃和启动失败报告后再提升为稳定渠道。

上述凭据与发布基础设施由维护者在准备真实发行时单独配置；公开仓库本身不应携带任何可用于签名或发布的秘密。

# 安全政策

## 支持范围

项目尚未发布稳定版本。当前只维护默认分支上的最新代码；历史提交和第三方自行打包的二进制不承诺安全更新。

## 私下报告漏洞

请不要为安全漏洞创建公开 Issue，也不要附上包含真实家庭数据的 `.family` 项目。

优先使用 GitHub 仓库 Security 页面中的 **Report a vulnerability**，或创建 [private security advisory](https://github.com/JingkaiTang/family-tree/security/advisories/new)。如果该入口不可用，请通过仓库所有者 GitHub 个人资料中公开的联系方式私下联系，并注明 `family-tree security`。

报告请尽量包含：

- 受影响的提交、平台和版本；
- 可重复的最小步骤或概念验证；
- 可能访问、修改或泄露的数据范围；
- 建议修复方式（如有）；
- 已脱敏的日志或样例项目。

维护者会尽力在 7 天内确认收到报告，在验证后协商披露和修复时间。请在修复发布前避免公开细节。

## 安全边界

- 家谱项目保存在用户选择的本地目录中，当前不加密；操作系统账户和磁盘权限仍是主要保护边界。
- WebView 不直接获得任意文件系统权限，照片通过校验项目根目录和媒体 ID 的 Rust 命令读取。
- 项目加载和保存会校验 schema、关系图完整性、文件大小与媒体输入限制。
- 自动更新、发布签名和安装包供应链尚未纳入当前 alpha 基线。

## 依赖风险

CI 会检查 npm 和 RustSec 已知漏洞，Dependabot 每月检查 npm、Cargo 与 GitHub Actions 更新。npm 中高危和 RustSec 漏洞应阻止合并；“unmaintained”等信息性公告会保留为可见告警，由维护者结合可达性和上游迁移条件评估。

Tauri 在 Linux 上仍依赖 GTK3/WebKitGTK 生态，其中部分间接 crate 已收到维护状态公告。项目没有静默忽略这些公告；在 Tauri 上游完成迁移前，将通过锁文件、最小 capability、CSP、自动审计和定期升级降低暴露面。

2026-10-02 核查时，锁文件还涉及以下两条 `unsound` 信息性公告：

- [`RUSTSEC-2024-0429`](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)：`glib 0.18.5` 的字符串迭代器存在未定义行为。Tauri 的 GTK 0.18 依赖链限制了 glib 版本；修复需要 glib 0.20 及以上，当前没有兼容的 0.18 补丁。
- [`RUSTSEC-2026-0097`](https://rustsec.org/advisories/RUSTSEC-2026-0097.html)：`rand 0.7.3` 经 `selectors → phf_codegen → phf_generator` 构建依赖链引入。当前未启用公告触发条件所需的 `log` feature，且 0.7 系列没有兼容补丁；这项核查不等于证明不存在风险。

这些告警继续保留在审计输出中，并跟踪上游修复与迁移；依赖或 feature 变化时需重新评估。

上述边界的实现细节见 [架构文档](docs/architecture.md)。

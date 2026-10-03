# 安全政策

## 支持范围

项目尚未发布稳定版本。当前只维护默认分支上的最新代码；历史提交和第三方部署的修改版本不承诺安全更新。

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

- 本地项目保存在用户选择的目录中；用户选择 Google Drive 后，家谱和处理后的照片会直接从浏览器上传到该账号的 Drive。项目、照片和备份没有应用层加密，不提供端到端加密；本地系统权限、Google 账号安全与 Drive 文件分享权限构成各自保护边界。
- Drive 仅申请 `drive.file`，访问本 OAuth 应用创建并识别的项目；不提供全盘浏览、自动共享或共享链接。Access token 只保留在页面内存，不写入 localStorage、IndexedDB、项目文件或日志。公开 OAuth Client ID 不是秘密；网页不得配置 Client Secret 或刷新令牌。
- Drive 连接身份绑定 OAuth Client ID 和 Google `permissionId`。重新授权选错账号会拒绝恢复原项目；失效授权不会在后台自行弹窗。用户可在 Google 账号的第三方应用权限中撤销授权。
- Drive 历史和照片不自动清理。从当前家谱移除照片不等于从云盘物理删除；要彻底删除项目及历史，需在 Drive 处理整个项目文件夹和回收站，并自行处理曾导出的备份或其他副本。
- 网页只能使用用户明确授权的目录句柄；项目和照片 IO 经过存储适配器，媒体标识和归档条目在访问文件前校验。
- 项目加载和保存会校验 schema、关系图完整性、文件大小与媒体输入限制。
- PWA 只缓存静态应用资源，不缓存项目或照片；更新等待旧窗口关闭，不强制刷新正在编辑的页面。静态站点部署权限和依赖供应链仍需妥善管理。配置 Drive 时还会加载 Google 托管登录脚本；运行网页的来源必须可信，页面内脚本拥有访问当前会话数据的能力。
- Drive 保存失败或离线时，未保存修改仅在当前页面内存中；草稿 JSON 可保留文字与关系，不含照片，不等同于完整备份。配置与已知限制见 [Google Drive](docs/google-drive.md)。

## 依赖风险

CI 执行 `npm audit --audit-level=moderate`，Dependabot 每月检查 npm 与 GitHub Actions 更新。达到审计阈值的漏洞应阻止合并；弃用或停止维护警告也应评估实际用途和上游迁移条件，不能等同于已证实的可利用漏洞。

准确依赖版本以 `package-lock.json` 为准。项目已经移除原生工程及其依赖，当前构建和审计只针对 Web/PWA；此前原生依赖的审计结果不代表当前依赖状态。兼容例外与已知安装警告见 [依赖管理](docs/dependencies.md)。

上述边界的实现细节见 [架构文档](docs/architecture.md)。

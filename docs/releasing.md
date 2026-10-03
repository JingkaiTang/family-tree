# Web/PWA 发布前置

项目当前处于 alpha 阶段，只分发静态网页与可安装 PWA。仓库没有自动发布工作流；公开部署前应完成本页检查。开发提交或推送不等于正式发布。

## 首次公开仓库前

1. 审查完整 Git 历史中的作者邮箱、已删除文件、自动化日志和素材。发现不宜公开的信息时，先确定脱敏和历史处理方案；历史重写需单独授权并协调协作者。
2. 确认仓库只包含虚构测试家谱和可公开素材，没有真实家庭数据、密钥或账号凭据。
3. 公开后启用 [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)、Dependabot alerts、secret scanning/push protection 和适用的代码扫描。
4. 按仓库协作方式配置 `main` 的保护规则，保留 CI 检查与禁止未经授权的历史重写；从外部 fork 验证 Pull Request 检查不依赖维护者 secrets。日常提交规则以 `AGENTS.md` 为准。
5. 检查仓库 About、topics 和支持入口，确认 README、Issue 模板与 `SECURITY.md` 中的链接在未登录窗口也能访问。

## 构建与部署

1. 使用 Node.js 24 LTS 和锁文件执行 `npm ci`。
2. 执行 CI 的类型检查、单元测试、生产构建、浏览器测试、布局性能和 npm 依赖审计。浏览器自动化不能替代目标设备的系统目录授权验收。
3. 更新 `package.json` 及锁文件中的版本，从 `CHANGELOG.md` 的 Unreleased 生成发布说明。
4. 将 `npm run build` 生成的完整 `dist/` 发布到 HTTPS 静态主机。记录构建提交、Node 版本与依赖锁文件；生产产物来自可信构建环境。
5. 配置资源路径、MIME 类型和缓存响应头，并验证根目录或实际子目录部署，具体要求见 [Web 部署说明](web-deployment.md)。

桌面和手机使用同一网页产物，不制作独立平台安装包。PWA 安装由浏览器提供；安装不会改变浏览器对普通目录 API 的支持范围。静态主机不存储用户家谱，也不需要业务后端或应用账号服务。

## 首次正式发布门槛

1. 在目标桌面 Chrome/Edge 和 Android Chrome 真机验证新建、打开、保存、照片导入、备份互导、撤销目录授权与再次授权。Safari/iOS Safari 和 Firefox 当前不支持普通目录 API，应明确显示限制。
2. 用生产产物验证首次离线缓存、断网重开、更新等待旧窗口关闭、安装后的启动路径，以及移动端安全区和横竖屏布局。
3. 验证存储失败、磁盘不足和外部修改冲突的提示；确认保存失败不会显示为已保存。
4. 确认安全报告入口可用，保留部署访问控制、依赖监测、第三方许可清单与所需署名。部署凭据只放在本机或 CI 密钥管理中。
5. 先公开测试版本，收集数据完整性、浏览器兼容性和启动失败报告，再决定稳定发布。

## 更新与回退

发布时完整部署同一构建的资源，避免页面、Service Worker 和资源清单来自不同版本。PWA 新版本会等待旧窗口关闭，不强制刷新编辑页面。保留可回退的已验证静态产物；回退应用前应核对项目 schema 兼容性，高版本数据不能假定可由旧网页打开。用户备份仍由用户保管，站点回退不会回退其本地项目文件。

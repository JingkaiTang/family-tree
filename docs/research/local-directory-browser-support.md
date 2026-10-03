# 用户授权本地目录：浏览器版本与限制

> 历史调研：正文记录实现前的候选方案与当时代码，不代表当前功能。项目现已仅保留 Web/PWA，已实现浏览器普通目录、图片处理和备份；原生工程已移除，Google Drive 尚未实现。当前支持范围以 [Web 部署说明](../web-deployment.md) 为准，架构与 IO 见 [架构说明](../architecture.md) 和 [存储接口](../storage.md)。

调研日期：2026-10-03。用户已选择普通本地目录作为优先主存储；应用继续按纯前端静态分发设计，不建立应用账号体系。本文记录资料核查与代码检查结果，未实现或实测浏览器目录读写。

## 支持范围与发布时间

这里的支持指用户通过 `showDirectoryPicker({ mode: 'readwrite' })` 选择普通文件夹，网页取得目录句柄并读写其中的文件；不把 OPFS、文件上传或下载算作同一种能力。

| 浏览器 / 平台 | 目录接口最低版本 | 该版本发布日期 | 结论 |
| --- | --- | --- | --- |
| Chrome 桌面版（Windows / macOS / Linux） | 86 | 2020-10-06 | 支持；日期采用 Google 稳定版公告 |
| Microsoft Edge 桌面版 | 86 | 2020-10-09 | 支持；日期采用 MDN 版本元数据 |
| Chrome Android | 132 | 2025-01-14 | MDN 标为支持；日期采用 MDN 版本元数据，仍需目标设备实测 |
| Safari macOS | 无 | — | 当前兼容数据列为不支持目录选择 |
| Safari iPhone / iPad | 无 | — | 当前兼容数据列为不支持目录选择 |
| Firefox 桌面版 / Android | 无 | — | 当前兼容数据列为不支持目录选择 |

接口来源：[MDN Window 兼容数据][1]。日期来源：[Google Chrome 86 公告][2]、[MDN Edge 版本元数据][3]、[MDN Chrome Android 版本元数据][4]。

日期证据有两点需要保留：

- MDN 的桌面 Chrome 86 日期为 2020-10-20，与 Google 公告的 2020-10-06 不同；Google 公告明确说明当日开始向稳定版推送，因此本表采用 Google 日期，不推断差异原因。
- Chrome Android 132 的日期没有独立核实到 Android 专属厂商公告，表中明确采用 MDN 数据。版本发布日期不保证每台设备同日收到更新或启用能力。

以上是 API 的支持门槛，不是整个项目的运行承诺。未逐一核实 Android Edge、Samsung Internet、各类内嵌 WebView 和 iOS 的第三方浏览器；不能仅凭品牌相同或 Chromium 内核就承诺相同能力。

## 不能用 OPFS 支持代替普通目录支持

`FileSystemDirectoryHandle`、`getFileHandle()` 或 `createWritable()` 出现在浏览器中，并不代表用户可以选择普通磁盘目录。Safari、Firefox 可以支持相关接口的 OPFS 用法，却缺少 `showDirectoryPicker()` 入口。[目录句柄兼容数据][5]、[文件写入兼容数据][6]。

应用需要检测目录选择、权限和写入的完整操作，并捕获实际访问失败。普通目录中的文件不占用 IndexedDB / OPFS 的站点存储配额，容量主要受实际磁盘、系统权限和文件系统限制；图片解码仍占浏览器内存，应使用缩略图与按需读取。[OPFS 与普通文件访问的区别][7]。

## 使用条件与限制

- **HTTPS 和用户主动操作。** 正式站点使用 HTTPS；开发时可使用受信任的 localhost。选择目录需要用户点击等操作，不能在页面加载时静默取得文件权限。使用读写模式申请保存权限。[目录选择文档][8]
- **授权范围有限。** 网站访问的是用户选择并授权的目录。浏览器可以拒绝系统敏感目录，系统权限和磁盘空间也会使读写失败。[目录选择文档][8]
- **重新打开需要检查权限。** 目录句柄可存入 IndexedDB，但句柄存在不等于当前有权限。恢复后调用 `queryPermission()`，必要时在用户操作下 `requestPermission()`；不要承诺永久授权。清除站点数据会丢失保存的句柄，但不会因此删除普通目录中的项目文件。[权限查询][9]、[权限申请][10]、[Google 文件访问说明][11]
- **嵌入预览与独立站点分别验证。** 跨来源 iframe 会受到权限和调用限制。ChatGPT Sites 上应以独立打开的正式 HTTPS 地址作为验收环境，不能只根据嵌入预览判断支持情况。[权限申请][10]
- **PWA 不补齐缺失接口。** 安装网页应用不会自动让 Safari / Firefox 获得目录选择能力，也不保证页面关闭后继续保存或同步。普通本地目录本身不提供跨设备同步。

## 对当前项目的影响

项目已有 `.family` 目录结构，包含 `meta.json`、`family.json`、备份、照片和缩略图，可以作为浏览器版的同一存储格式。需新增浏览器目录存储实现，用句柄代替当前 Tauri 路径调用；图片处理也需浏览器实现。[目录格式](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/docs/project-format.md#L5)、[当前存储接口](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/tauriApi.ts#L1)

当前安装 Vite 8.1.5，[配置](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/vite.config.ts#L9) 未设置 `build.target`；其默认目标包括 Chrome 111 / Edge 111。[版本固定的 Vite 常量][12]与本地安装内容一致。这只是构建目标，不包含所有运行时 API 和 CSS 兼容保证。项目还使用 [structuredClone](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/core/migrate.ts#L37)、`Array.at()`、[color-mix()](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/components/tree/FamilyUnit.vue#L129) 和 Tailwind 4 的颜色能力，因此不能把 Chrome / Edge 86 作为项目最低版本，也不能未经测试承诺 111 全部可用。

建议首版以**近期稳定版桌面 Chrome / Edge**为正式验证目标，**Android Chrome 132 及以上**作为移动端候选并进行真机验证。iPhone / iPad 的 Safari 需要另一种存储体验，例如完整归档导入导出或后续云盘适配；如果要求同样的普通目录持续读写能力，需要评估原生客户端。

浏览器保存仍需单独设计备份、写入中断恢复和并发修改检测，不能直接继承 Rust 临时文件加 rename 的保存保证。现有自动保存的进程内修订号也不等于跨标签页或跨设备冲突保护。[Rust 保存逻辑](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src-tauri/src/commands/project.rs#L268)、[自动保存](https://github.com/JingkaiTang/family-tree/blob/c33861279d48b93c33b00d2ea92e8d66407e8c23/src/services/autosave.ts#L49)

后续实现的验收应覆盖：首次选目录并写入、重启浏览器后重开项目、权限撤销后恢复、磁盘满或中断时恢复、多个页面同时编辑，以及大量照片的按需读取。当前未执行这些功能测试；正式最低版本应在实现后根据目标设备结果确定。

## 来源

[1]: https://github.com/mdn/browser-compat-data/blob/main/api/Window.json
[2]: https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/blog/new-in-chrome-86/index.md
[3]: https://github.com/mdn/browser-compat-data/blob/main/browsers/edge.json
[4]: https://github.com/mdn/browser-compat-data/blob/main/browsers/chrome_android.json
[5]: https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemDirectoryHandle.json
[6]: https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemFileHandle.json
[7]: https://github.com/mdn/content/blob/main/files/en-us/web/api/file_system_api/origin_private_file_system/index.md
[8]: https://github.com/mdn/content/blob/main/files/en-us/web/api/window/showdirectorypicker/index.md
[9]: https://github.com/mdn/content/blob/main/files/en-us/web/api/filesystemhandle/querypermission/index.md
[10]: https://github.com/mdn/content/blob/main/files/en-us/web/api/filesystemhandle/requestpermission/index.md
[11]: https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/articles/file-system-access/index.md
[12]: https://github.com/vitejs/vite/blob/v8.1.5/packages/vite/src/node/constants.ts

Google 文件访问说明是历史文章，本文只引用其中句柄存储机制；其中旧版 Android 支持及权限持久性描述不作为当前兼容结论。

# 移动端开发与验收

Family Tree 优先维护一套 Web UI、Pinia 状态和领域逻辑，通过统一存储接口适配平台。支持普通目录 API 的移动浏览器使用同一 Web/PWA；iOS/Android 原生包作为可选宿主保留，复用界面并提供 Rust 存储与系统文档交互。

移动网页仅支持具有 `showDirectoryPicker` 的浏览器，Android Chrome 的 API 门槛为 132（2025-01-14），仍需目标设备验收。Safari/iOS Safari 当前不支持，不提供浏览器私有存储降级；iOS 可以继续使用原生宿主。部署与网页验收见 [Web 部署说明](web-deployment.md)。

## 行为边界

- iOS/Android 默认使用聚焦纵流，原生桌面默认使用家族网格；用户的显式选择优先，并只保存在当前设备。
- 原生移动端项目位于应用私有 AppData 的 `projects/<uuid>.family`，不允许前端传入任意项目路径。它不同于移动网页授权的普通目录；本次没有扩展原生手机的任意目录持续读写能力。
- `.familybundle` 经系统文档选择器和 AppCache `transfers/` 暂存区导入/导出；导入始终创建新项目，不覆盖已有项目。
- 目录选择和备份传输由 Rust 原生命令完成，WebView 没有通用 fs 权限。原生传输保留 Android 文档 URI 与 iOS 文件 URL，流读取最多接受 512 MiB，并在成功、取消或失败后回收缓存；iOS 文件访问结束后释放安全作用域。
- 当前 Tauri 配置未覆盖默认最低版本：iOS 15、Android API 24。iOS 导入使用安全作用域的原位置读取，不把旧插件的 iOS 13 回退行为当作当前支持路径。
- Web 普通目录、桌面外部项目和移动托管项目共用 `family.json` schema、迁移、关系校验及自动保存；浏览器与 Rust 的照片处理均输出相同尺寸的 WebP。
- 当前没有云同步或多端自动合并；跨设备迁移使用导出/导入备份。
- 原生移动项目迁移到网页：先导出 `.familybundle`，再在支持目录 API 的浏览器中先选备份文件、后选空目录。卸载原生应用前先确认备份可恢复。
- 原生宿主不注册网页 Service Worker；PWA 与原生分发分别管理应用更新，不复制 UI 或领域功能实现。

## 工具链

先完成 README 的 Node.js、Rust 与 Tauri 依赖，再按 [Tauri 2 移动端前置要求](https://v2.tauri.app/start/prerequisites/)准备平台工具链。

### iOS

- 仅支持 macOS；安装完整 Xcode，不只是 Command Line Tools。
- 启动一次 Xcode 并接受许可，确保 `xcodebuild -version` 可用。
- 配置 Apple Development Team（`bundle.iOS.developmentTeam` 或 `APPLE_DEVELOPMENT_TEAM`）与所需签名，准备模拟器或真机。签名凭据仅放本机/CI，正式分发另按 Apple 要求准备。

### Android

- 安装 Android Studio，以及 Tauri 要求的 SDK、NDK、Build Tools 和 Platform Tools。
- 配置 Android SDK/NDK 环境，确保 `adb` 能识别模拟器或真机。
- 接受所需 SDK 许可并准备一个可运行目标。
- 本地开发无需 Google Play 账号；正式分发时另外配置 Android 签名 keystore。

可先运行 `npm run tauri -- info` 检查主机环境。工具链不完整时，移动端初始化/构建失败不代表共享前端或 Rust 代码失败。

## 初始化、开发与构建

每个 checkout 首次运行移动端目标前执行：

```bash
npm ci
npm run tauri:ios:init
npm run tauri:android:init
```

生成的 `src-tauri/gen/` 是本机原生工程，已在 `.gitignore` 中忽略。日常开发与构建：

```bash
npm run tauri:ios:dev
npm run tauri:ios:build

npm run tauri:android:dev
npm run tauri:android:build
```

如果只验证共享网页代码，不需要移动工具链：

```bash
npm test
npm run build
npm run test:e2e
npm run test:layout-perf
```

验证原生 Rust 代码还需要当前主机的 Tauri 系统依赖：

```bash
cd src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
```

性能门禁应单独运行，避免与 Rust 编译或其他高 CPU 作业并发造成失真。

## 真机验收清单

下列流程仍需在目标 iOS/Android 设备或模拟器验收；共享代码测试或主机 Rust 测试通过不代表移动系统选择器已验证：

1. 冷启动后新建托管项目，确认默认布局为“自动（纵流）”。
2. 新建、编辑、删除成员和关系，上传/裁剪照片，返回树后重新打开验证数据。
3. 在未保存状态切后台再恢复，确认修改仍在且没有重复项目或损坏提示。
4. 切换家族网格与聚焦纵流，重启应用后确认设备偏好保留，项目数据不因此变脏。
5. 检查刘海、状态栏、底部手势区、横竖屏、小屏表单、键盘弹出和长列表滚动。
6. 导出 `.familybundle` 到系统文件位置，再导入为新项目；核对成员、关系和照片。
7. 尝试取消导入/导出、选择错误文件和导入未来版本，确认原项目不被覆盖且临时文件被清理。
8. 彻底结束并重启应用，复查最近项目、自动保存和备份恢复路径。

真实发布前还需要签名、商店元数据、隐私披露和平台发布构建；这些不属于源码开发构建门禁。

# 移动端开发与验收

Family Tree 的 iOS/Android 版本与桌面端共享 Vue、Pinia、领域逻辑和 Rust 命令。平台差异只位于项目存储、系统文档选择器、窗口配置和默认 UI 投影。

## 行为边界

- iOS/Android 默认使用聚焦纵流，原生桌面默认使用家族网格；用户的显式选择优先，并只保存在当前设备。
- 移动端项目位于应用私有 AppData 的 `projects/<uuid>.family`，不允许前端传入任意项目路径。
- `.familybundle` 经系统文档选择器和 AppCache `transfers/` 暂存区导入/导出；导入始终创建新项目，不覆盖已有项目。
- 桌面外部项目和移动托管项目共用 `family.json` schema、迁移、关系校验、自动保存和媒体处理。
- 当前没有云同步或多端自动合并；跨设备迁移使用导出/导入备份。

## 工具链

先完成 README 的 Node.js、Rust 与 Tauri 依赖，再按 [Tauri 2 移动端前置要求](https://v2.tauri.app/start/prerequisites/)准备平台工具链。

### iOS

- 仅支持 macOS；安装完整 Xcode，不只是 Command Line Tools。
- 启动一次 Xcode 并接受许可，确保 `xcodebuild -version` 可用。
- 准备 Apple 开发者签名和至少一个模拟器或真机目标。

### Android

- 安装 Android Studio，以及 Tauri 要求的 SDK、NDK、Build Tools 和 Platform Tools。
- 配置 Android SDK/NDK 环境，确保 `adb` 能识别模拟器或真机。
- 接受所需 SDK 许可并准备一个可运行目标。

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

如果只验证共享代码，不需要移动工具链：

```bash
npm test
npm run build
npm run test:layout-perf

cd src-tauri
cargo fmt --all -- --check
cargo test --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
```

性能门禁应单独运行，避免与 Rust 编译或其他高 CPU 作业并发造成失真。

## 真机验收清单

至少在一台 iOS 和一台 Android 设备或模拟器上完成以下流程：

1. 冷启动后新建托管项目，确认默认布局为“自动（纵流）”。
2. 新建、编辑、删除成员和关系，上传/裁剪照片，返回树后重新打开验证数据。
3. 在未保存状态切后台再恢复，确认修改仍在且没有重复项目或损坏提示。
4. 切换家族网格与聚焦纵流，重启应用后确认设备偏好保留，项目数据不因此变脏。
5. 检查刘海、状态栏、底部手势区、横竖屏、小屏表单、键盘弹出和长列表滚动。
6. 导出 `.familybundle` 到系统文件位置，再导入为新项目；核对成员、关系和照片。
7. 尝试取消导入/导出、选择错误文件和导入未来版本，确认原项目不被覆盖且临时文件被清理。
8. 彻底结束并重启应用，复查最近项目、自动保存和备份恢复路径。

真实发布前还需要签名、商店元数据、隐私披露和平台发布构建；这些不属于源码开发构建门禁。

## 问题与方案

<!-- 说明问题、根因和本 PR 的最小解决方案。 -->

## 风险与兼容性

<!-- 数据格式、迁移、桌面权限、性能、跨平台或回滚风险。没有也请说明。 -->

## 验证

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --audit-level=moderate`
- [ ] `npm run test:layout-perf`（布局相关改动）
- [ ] `cargo fmt --all -- --check`（Rust 相关改动）
- [ ] `cargo test --locked`（Rust 相关改动）
- [ ] `cargo clippy --all-targets --all-features --locked -- -D warnings`（Rust 相关改动）
- [ ] `cargo audit`（依赖变更）
- [ ] 已补充或更新回归测试
- [ ] 已检查没有真实家谱、密钥、凭据或无关生成文件

## 界面变化

<!-- 如有界面变化，附脱敏截图；否则写“无”。 -->

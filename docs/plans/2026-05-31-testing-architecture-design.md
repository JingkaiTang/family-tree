# 三层测试体系架构设计

## 背景

family-tree 项目原有 6 个 vitest 单元测试文件，覆盖亲属称谓计算、数据适配、树布局等核心逻辑层，但全部为 `node` 环境纯 TypeScript 测试，缺少 Vue 组件集成测试和端到端场景测试。

## 三层架构

### L1: 逻辑单元测试
- **工具**: Vitest + Node 环境
- **职责**: 纯函数无副作用，称谓计算、数据适配、布局算法
- **现状**: 已有 6 个测试文件，193 个用例，保持不动

### L2: 组件集成测试
- **工具**: Vitest + @vue/test-utils + happy-dom
- **职责**: Vue 组件挂载、交互模拟、Store 联动、DOM 渲染验证
- **通过文件级 pragma 切换环境**: `// @vitest-environment happy-dom`

### L3: Agent 驱动场景测试
- **工具**: Vitest + Agent 生成 fixture 和场景脚本
- **职责**: 全家族称谓遍历验证、布局规则验证、边界覆盖

## 目录结构

```
src/
  __tests__/
    fixtures/
      families.ts          # 共享测试数据 (mk, addParent, addSpouse 等工具函数)
    components/            # L2 组件集成测试
    e2e/
      scenarios/           # L3 Agent 驱动场景
  core/
    *.test.ts              # L1 单元测试 (保持 co-located)
```

## 技术选型

- **happy-dom 而非 jsdom**: 对 Vue 3 Composition API 支持更好
- **不引入 Playwright**: Tauri 桌面应用无浏览器上下文
- **不引入 @pinia/testing**: Pinia store 手动管理更直接

## P0 交付 (已完成)

1. 安装 @vue/test-utils 和 happy-dom
2. 更新 vitest.config.ts (默认 node 环境，globals: true)
3. 创建 `src/__tests__/` 目录结构
4. 共享 fixtures (`families.ts`): mk(), addParent(), addSpouse(), 预定义家族结构
5. MemberForm 组件集成测试 (9 个用例，覆盖渲染、v-model、按钮事件、外部更新)
6. 全量 194 测试通过

## 待办

- P1: FamilyCanvas + MemberNode 组件测试
- P1: Agent 生成称谓全量回归场景
- P2: SearchBar + PhotoCropper 组件测试
- P2: Agent 生成布局验证 + 边界覆盖

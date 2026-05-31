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
5. MemberForm 组件集成测试 (9 用例)
6. 全量 194 测试通过

## P1 交付 (已完成)

7. MemberNode 组件集成测试 (19 用例)
   - 姓名渲染：姓+名 / 缺姓 / 缺名→未命名 / nickname 回退
   - 性别符号：♂ / ♀ / ·
   - 性别边框：sky-400 / pink-400
   - 生卒格式化、称呼标签显示
   - selected/isViewpoint 环样式
   - click/dblclick 事件 + member.id 传递
   - 节点绝对定位

8. FamilyCanvas 组件集成测试 (5 用例)
   - 空状态提示
   - 孤儿节点数量提示
   - SVG 连线渲染
   - 无布局时不渲染
   - 无孤儿时不显示提示

9. **L3 Agent 驱动场景**: 四代家族全量称谓回归 (45 用例)
   - self 视角覆盖 32 种关系：直系/祖辈/兄弟姐妹/叔伯姑/舅姨/堂表/侄甥/孙辈/姻亲
   - 非对称关系验证 (父亲→我、叔叔→我、配偶视角)
   - 跨代旁系
   - 边界场景 (自己、陌生人)
   - **发现 8 个已知 BUG**（已标记在测试用例名中）

## 已知称谓 BUG (共计 8 个)

| # | 场景 | 期望 | 实际 | 类别 |
|---|------|------|------|------|
| 1 | self → 堂姐 (cousin_p_f, older) | 堂姐 | 堂妹 | 年龄对比 |
| 2 | self → 表兄(姑) (cousin_ap_m, younger) | 表兄 | 表弟 | 年龄对比 |
| 3 | self → 表兄(舅) (cousin_m_m) | 表兄 | 堂弟 | 堂/表判断+年龄 |
| 4 | self → 表姐(舅) (cousin_m_f) | 表姐 | 堂妹 | 堂/表判断+年龄 |
| 5 | son → gpa | 祖父 | 曾祖父 | 跨代跳代 |
| 6 | son → mgp | 外祖父 | 曾祖父 | 跨代跳代 |
| 7 | son → uncle_p | 叔父 | 叔公 | 跨代称谓 |
| 8 | 陌生人不在关系网 | null | 亲戚 | 边界处理 |

## 测试统计

| 层级 | 文件数 | 用例数 | 状态 |
|------|--------|--------|------|
| L1 单元 | 6 | 185 | ✅ 全部通过 |
| L2 组件 | 3 | 33 | ✅ 全部通过 |
| L3 场景 | 1 | 45 | ✅ 全部通过 (含 8 个 BUG 标记) |
| **合计** | **10** | **263** | **100% pass** |

## 待办

- P2: SearchBar + PhotoCropper 组件测试
- P2: Agent 生成布局验证场景
- P2: 修复 8 个已知 BUG

# 家族树 (Family Tree)

一款轻量级中文家族关系管理桌面应用，基于 Tauri 2 构建。可视化管理家族成员，自动计算亲戚间的中文称谓。

## 功能特性

- **家族树可视化** — 当前夫妻显示为带柔和底色、可整体拖动的家庭单元；同代家庭按可排序网格排列，拖动后保存语义行顺序并局部重排。
- **血缘与姻亲排布** — 优先保持血缘核心相邻；跨血缘婚姻进入桥接带，关系过密时合并为稳定的 supercomponent。
- **家庭专属连线** — 父母与子女使用家庭配色的独占通道；不同家庭不共用线段，垂直交叉处显示跨线桥。
- **辅助关系开关** — 按需显示选中成员的历史配偶、次要父母与干亲关系，不改变主布局代际。
- **中文称谓自动计算** — 输入任意两个成员，自动推算出正确的中文亲戚称呼
  - 直系亲属：父母、祖父母、子女、孙辈……
  - 旁系亲属：兄弟姐妹、堂/表兄弟、侄/甥……
  - 姻亲：配偶的亲属、亲属的配偶、妯娌/连襟……
  - 特殊关系：继父母/养子女、半亲兄弟姐妹、干亲
  - 长幼区分：哥哥/弟弟、伯父/叔叔、嫂子/弟媳……
- **成员信息管理** — 姓名、性别、出生日期、照片、籍贯、职业等
- **自定义称呼** — 支持为特定关系手动覆盖自动计算的称谓（如"二叔"）
- **本地数据** — 所有数据存储在本地文件，无需联网，隐私安全

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | Vue 3 + TypeScript |
| 状态管理 | Pinia |
| 样式 | Tailwind CSS |
| 构建工具 | Vite 6 |
| 桌面框架 | Tauri 2 (Rust) |
| 家族树布局 | 自研 family-unit 代际网格与 family-owned lane 路由 |
| 缩放/拖拽 | @panzoom/panzoom |
| 数据校验 | Zod |
| 测试 | Vitest |

### 称谓计算架构

称谓系统采用三层流水线设计：

```
BFS 寻路 → 路径规范化 → 模式匹配翻译
```

1. **BFS 寻路** (`pathFinder.ts`)：在家族关系图中广度优先搜索最短路径，边类型包括 parent/child/spouse/sibling
2. **路径规范化** (`normalizePath`)：将 sibling 边展开为 parent + child，使路径仅含三种基本边，便于分类
3. **模式匹配翻译** (`chineseTerms.ts`)：根据路径中边的组合模式（纯 parent → 直系祖先、parent+child → 旁系、末尾 spouse → 姻亲……）查表翻译为中文称谓

关键设计点：
- **堂/表判定**：分叉点（从共同祖先往下的第一步）性别决定——男→堂（同姓），女→表（异姓）
- **侄/甥判定**：同辈旁系亲属性别决定——男→侄，女→外甥
- **代际差**：`genDiff = up - down`（parent 步数减 child 步数），正=长辈，0=同辈，负=晚辈
- **长幼区分**：利用成员 `birthDate` 比较年龄，无生日时回退为合并标签（如"叔伯"）

### 家族树布局架构

布局入口是 `src/core/treeLayout.ts`，核心纯函数流水线位于 `src/core/family-layout`：

```text
关系规范化 → 主/辅助关系投影 → 家庭单元构建 → 代际分配
→ 血缘聚类与桥接带 → 同代排序与网格压紧 → 家庭专属通道路由 → 场景校验
```

- 当前夫妻合并为一个柔和背景的家庭单元；单身成员保持独立单元，每位成员在主场景中只出现一次。
- 同代单元可排序并吸附逻辑网格；血缘亲近度决定默认邻接，跨血缘婚姻使用 bridge band，密集连接回退为 supercomponent。
- 每组父母与子女拥有独立颜色和 lane，允许点状交叉但禁止跨家庭共享线段或形成错误 T 形连接；交叉点由 bridge 显示层次。
- “辅助关系”开关仅为选中成员绘制历史婚姻、次要亲子和干亲虚线，不参与主代际与主网格计算。

## 开发

### 环境要求

- **Node.js** >= 18
- **Rust** (通过 [rustup](https://rustup.rs/) 安装，需 MSVC 工具链)
- **Windows**: Visual Studio Build Tools 2022（MSVC C++ 工作负载）

### 安装依赖

```bash
npm install
```

### 启动 Web 开发服务器

```bash
npm run dev
```

浏览器访问 http://localhost:5173

### 启动 Tauri 桌面应用

```bash
npm run tauri:dev
```

> **Windows 注意**：需将 MSVC `link.exe` 所在目录加到 PATH 最前面，避免 Git Bash 的 `link` 冲突：
> ```powershell
> $env:PATH = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;$env:PATH"
> ```
>
> 另需确保 rustup 默认工具链为 msvc：
> ```bash
> rustup default stable-x86_64-pc-windows-msvc
> ```
>
> Windows Hyper-V 保留了端口范围 1348-1447，原配置的 1420 端口会导致 EACCES 错误，已改为 5173。

### 构建桌面安装包

```bash
npm run tauri:build
```

产物在 `src-tauri/target/release/bundle/` 下。

### 运行测试

```bash
npm test
npm run test:layout-perf
```

`test:layout-perf` 使用确定性的 500 人连通家谱，并在受控机器上执行 1000ms CI 预算门禁；普通 `npm test` 只验证正确性，避免共享机器负载造成偶发失败。

### 类型检查

```bash
npm run typecheck
```

## 项目结构

```
src/
├── core/                    # 核心业务逻辑
│   ├── schema.ts            # 数据模型（Zod 定义）
│   ├── kinship/             # 称谓计算系统
│   │   ├── index.ts         # 统一入口：override → 干亲 → BFS → 翻译
│   │   ├── pathFinder.ts    # BFS 寻路 + 路径规范化
│   │   └── chineseTerms.ts  # 路径 → 中文称谓翻译
│   ├── treeLayout.ts        # 默认布局异步门面
│   ├── family-layout/       # family-unit 网格、血缘聚类、lane 路由与场景校验
│   ├── relativesAdapter.ts  # relatives-tree 兼容适配与历史行为测试
│   └── migrate.ts           # Schema 版本迁移
├── components/              # 通用组件
│   ├── member/              # 成员相关组件
│   ├── tree/                # 树视图组件
│   └── search/              # 搜索组件
├── pages/                   # 页面组件
├── stores/                  # Pinia 状态仓库
├── services/                # Tauri API 封装
├── router/                  # Vue Router
└── styles/                  # 全局样式

src-tauri/                   # Rust 后端
├── src/
│   ├── lib.rs               # Tauri 插件注册
│   └── commands/            # Tauri 命令（文件读写等）
└── Cargo.toml
```

## License

MIT

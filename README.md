# 家族树 (Family Tree)

一款轻量级中文家族关系管理桌面应用，基于 Tauri 2 构建。可视化管理家族成员，自动计算亲戚间的中文称谓。

## 功能特性

- **家族树可视化** — 默认使用强约束家庭单元布局：配偶/父母作为家庭单元，子女按代际和出生日期稳定排列；支持缩放、拖拽和默认布局下的手工位置覆盖
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
| 家族树布局 | 自研强约束家庭单元布局；elkjs 保留为旧布局引擎 |
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
```

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
│   ├── treeLayout.ts        # 默认布局门面，调用强约束家庭单元布局
│   ├── layout/              # 默认家族树语义模型与约束布局引擎
│   ├── elkLayout.ts         # ELK.js 旧布局引擎
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

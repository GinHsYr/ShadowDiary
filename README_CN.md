<h1 align="center">影迹</h1>
<h6 align="center">Shadow Diary</h6>

<p align="center">
  <img src="resources/icon.png" width="120" alt="Shadow Diary Logo" />
</p>

影迹是一个本地优先的桌面日记应用，基于 Electron、Vue 3、TypeScript 和加密 SQLite 数据库构建。

中文 | [English](README.md)

## 项目概览

影迹将主要应用数据保存在本机，并使用 Electron 作为系统能力与 Vue 渲染层之间的边界。主进程负责持久化、文件系统访问、图片处理、应用更新、数据导入导出、Windows Hello 验证以及可选的本地 MCP 服务。渲染层专注于用户体验，包括写作、搜索、概览、档案管理、媒体浏览、设置、隐私锁状态和多语言界面。

## 核心功能

- 富文本日记编辑器，支持图片插入、粘贴、拖拽、搜索和替换。
- 日记元数据管理，包括标题、心情、标签、天气、创建时间和更新时间。
- 概览页提供日历活动、写作统计、心情分布和人物提及分析。
- 档案系统支持人物、物品和其他记录，并包含别名与图片集。
- 全局搜索覆盖日记文本、元数据、标签、日期范围和档案别名。
- 媒体库基于日记和档案中的图片引用构建。
- 隐私控制支持 PIN 或 Windows Hello 解锁、空闲锁定、系统锁屏联动和伪装模式。
- 使用 `better-sqlite3-multiple-ciphers` 管理本地加密数据库。
- 基于 ZIP 的数据导入导出，覆盖数据库、图片、缩略图、附件和元数据。
- 可选本地 MCP 端点，供外部工具受控搜索和读取日记内容。
- 多语言界面：简体中文、英文、日文、韩文。
- 基于 `electron-updater` 的自动更新流程。

## 架构

```text
Electron App
├─ Main process（主进程）
│  ├─ BrowserWindow 生命周期、导航策略、更新器、IPC 注册
│  ├─ SQLite/SQLCipher 数据库初始化与迁移
│  ├─ 日记、档案、标签、附件、媒体、设置和统计服务
│  ├─ 图片存储、缩略图生成和 diary-image:// 自定义协议
│  ├─ 数据导入导出编排
│  ├─ 基于 SafeStorage 的本地密钥管理
│  ├─ 伪装模式数据与会话处理
│  ├─ 可选本地 MCP HTTP 服务
│  └─ Windows Hello 辅助进程集成
├─ Preload（预加载）
│  └─ 基于 IPC 的类型化 `window.api` 桥接层
└─ Renderer（渲染层）
   ├─ Vue 应用外壳、路由、布局和页面
   ├─ Pinia stores：用户、主题、隐私、伪装、语言、启动和 AI 设置
   ├─ 富文本编辑器、日记列表、档案组件、媒体灯箱和设置页面
   └─ i18n 多语言资源
```

## 源码结构

```text
src/
  main/
    index.ts                 # Electron 启动、窗口、IPC、更新器、协议处理
    database/                # SQLCipher 连接、迁移、仓储、搜索索引
    mcp/                     # 本地 MCP 服务与工具注册
    privacy/                 # 伪装模式会话与种子数据
    security/                # SafeStorage 工具与数据库密钥处理
    utils/                   # 图片、附件、路径检查、导入导出工具
  preload/
    index.ts                 # 通过 contextBridge 暴露给渲染层的 API
    index.d.ts               # 渲染层 window 类型声明
  renderer/src/
    App.vue                  # 应用外壳、隐私锁、侧边栏/顶部栏布局
    main.ts                  # Vue、Pinia、路由、i18n 初始化
    router/                  # Hash 路由页面映射
    components/              # 共享 UI 组件
    views/                   # 概览、今日、档案、媒体、设置页面
    stores/                  # Pinia 状态模块
    i18n/                    # 多语言初始化和语言包
  native/
    ShadowDiary.WindowsHello # Windows Hello 支持与验证的 .NET 辅助程序
  types/
    api.ts                   # IPC API 契约
    model.ts                 # 共享领域模型
resources/                   # 安装器资源与应用素材
build/                       # 图标和平台打包资源
```

## 数据模型

应用数据库由 `src/main/database/migrations.ts` 创建和迁移。当前主要领域包括：

- `diary_entries`：富文本内容、纯文本内容、心情、时间戳和元数据。
- `tags` / `diary_tags`：日记标签的多对多关系。
- `attachments`：关联到日记条目的附件元数据。
- `settings`：用户、隐私、语言、主题、AI 和 MCP 偏好。
- `archives`：人物、物品和其他档案，支持别名和图片。
- `image_refs`：已存储日记图片的引用计数。
- `person_mention_stats`：人物档案的提及次数缓存。
- `media_source_refs`：跨日记和档案的媒体库索引。

搜索逻辑会组合日记索引文本、结构化筛选、标签和档案别名扩展。媒体浏览依赖来源引用记录，因此同一张图片可以回溯到一个或多个日记/档案上下文。

## 运行时数据

运行时数据位于 Electron `app.getPath('userData')` 目录。

常见文件与目录：

- `diary.db`：加密 SQLite 数据库。
- `db-key.json`：通过 Electron `safeStorage` 存储的本地数据库密钥材料。
- `images/`：存储后的 WebP 原图。
- `thumbnails/`：生成的 WebP 预览图。
- `attachments/`：复制保存的附件文件。

日记内容中的图片通过 `diary-image://` 自定义协议引用，并由主进程解析读取。

## MCP 集成

可选 MCP 服务可在 AI/MCP 设置页中配置，并监听 `127.0.0.1`。它提供受控工具用于：

- 搜索日记条目。
- 按 id 或日期范围读取日记文本。
- 批量获取日记元数据。
- 按名称或别名搜索档案记录。

运行时实现位于 `src/main/mcp/server.ts`，请求校验使用 `zod`。

## Windows Hello 辅助程序

Windows Hello 支持由 `src/native/ShadowDiary.WindowsHello` 中的小型 .NET 辅助项目实现。Electron 主进程会启动该辅助程序执行支持检测和验证请求。Windows 发布构建会运行：

```bash
npm run build:windows-hello-helper
```

编译后的辅助程序会通过 `electron-builder.yml` 作为额外资源打包。

## 技术栈

- Electron 39 + electron-vite
- Vue 3 + TypeScript
- Pinia + Vue Router
- Naive UI + Ionicons
- Froala Editor
- ECharts + vue-echarts
- better-sqlite3-multiple-ciphers
- sharp
- @modelcontextprotocol/sdk
- electron-updater
- electron-builder
- .NET Windows Hello 辅助程序

## 环境要求

- Node.js `>= 22`
- npm
- 构建包含 Windows Hello 辅助程序的 Windows 包时需要 .NET SDK

## 开发

安装依赖：

```bash
npm install
```

注意：Electron、Sharp、SQLite 和构建工具包含操作系统相关的原生模块。Windows 和 WSL/Linux 可以共用源码与 `package-lock.json`，但不要共用同一个 `node_modules`；请分别在 Windows 工作目录和 Linux 工作目录执行 `npm ci`。在 Windows 使用 `npm run build:win`，在 Linux 使用 `npm run build:linux`。

以开发模式运行桌面应用：

```bash
npm run dev
```

预览构建后的应用：

```bash
npm run start
```

## 脚本

```bash
# 代码质量
npm run lint
npm run format
npm run typecheck

# 构建 renderer/main/preload 产物
npm run build

# 打包类型
npm run build:unpack
npm run build:win
npm run build:win:msi
npm run build:win:all
npm run build:mac
npm run build:linux

# Windows Hello 辅助程序
npm run build:windows-hello-helper

# 发布到 GitHub Releases
npm run release
```

## 打包

打包配置位于 `electron-builder.yml`。

- Windows：NSIS 和 MSI。
- macOS：DMG 和 ZIP。
- Linux：AppImage 和 DEB。
- `asarUnpack` 包含原生 `.node` 模块。
- `build/windows-hello-helper` 会作为 Windows 包的额外资源复制。

Windows 静默安装示例：

```bash
# NSIS
ShadowDiary-<version>-<os>-<arch>-setup.exe /s

# MSI
msiexec /i ShadowDiary-<version>-<os>-<arch>.msi /qn
```

## License

[MIT](LICENSE)

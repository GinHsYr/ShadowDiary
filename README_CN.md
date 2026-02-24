<h1 align="center">影迹</h1>
<h6 align="center">Shadow Diary</h6>

<p align="center">
  <img src="resources/icon.png" width="120" alt="Shadow Diary Logo" />
</p>

一个基于 Electron + Vue 3 + TypeScript 的本地轻量级日记应用。

中文|[English](README.md)
## 功能特性

- 日记编辑
  - 富文本编辑（支持图片）
  - 标题、心情等信息管理
- 概览
  - 月历写作提示
  - 详细的统计提示信息
- 全局搜索
  - `Ctrl/Cmd + K` 快捷搜索
  - 关键字、心情、标签、日期范围、档案联合筛选
- 档案系统
  - 人物/物品/其他分类管理
  - 别名支持，搜索会联动档案别名扩展
- 隐私与安全
  - 应用锁（6 位数字密码 / Windows PIN）
  - 空闲自动锁定、系统锁屏联动
  - SQLite 数据库加密（SQLCipher）
- 数据导入导出
  - 一键导出为 ZIP 备份
  - 备份口令保护
- 自动更新
  - 检查、下载、安装更新（基于 `electron-updater`）
- i18n支持

## 技术栈

- Electron + electron-vite
- Vue 3 + TypeScript + Pinia + Vue Router
- Naive UI + ECharts
- better-sqlite3-multiple-ciphers (SQLCipher)
- sharp（图片处理）
- electron-builder（打包）

## 项目结构

```text
src/
  main/                    # Electron 主进程（IPC、数据库、文件与安全）
    database/              # 数据访问与迁移
    security/              # 本地密钥管理
    utils/                 # 图片存储、数据导入导出
  preload/                 # contextBridge 暴露给渲染层的安全 API
  renderer/src/            # Vue 前端
    components/            # 通用组件（侧边栏、搜索、编辑器等）
    views/                 # 页面（dashboard/today/archives/settings）
    stores/                # Pinia 状态管理（主题、隐私、用户）
resources/                 # 图标、安装脚本等静态资源
```

## 快速开始

### 环境要求

- Node.js `>= 22`
- npm（建议使用与 Node 配套的最新版本）

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run dev
```

### 预览运行

```bash
npm run start
```

## 常用脚本

```bash
# 代码质量
npm run lint
npm run format
npm run typecheck

# 构建
npm run build
npm run build:unpack
npm run build:win
npm run build:win:msi
npm run build:win:all
npm run build:mac
npm run build:linux

# 发布（GitHub Releases）
npm run release
```

## 数据与安全说明

- 应用数据位于 Electron `app.getPath('userData')` 目录。
- 关键数据包括：
  - `diary.db`：加密数据库（SQLCipher）
  - `images/`、`thumbnails/`：图片与缩略图
  - `db-key.json`：本地数据库密钥文件（通过 Electron `safeStorage` 加密后存储）
- 导出备份为 ZIP，包含数据库、附件、元数据及加密图片包。
- 备份口令最小长度为 8 位。

## 打包与安装

### 多平台打包

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

### Windows 静默安装

```bash
# NSIS
ShadowDiary-<version>-<os>-<arch>-setup.exe /s

# MSI
msiexec /i ShadowDiary-<version>-<os>-<arch>.msi /qn
```
## License

[MIT](LICENSE)

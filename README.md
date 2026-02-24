# Shadow Diary

<p align="center">
  <img src="resources/icon.png" width="120" alt="Shadow Diary Logo" />
</p>

A lightweight local diary application built with Electron + Vue 3 + TypeScript.
[中文](README_CN.md) | [English](README.md)

## Features

* **Diary Editing**

  * Rich text editor (with image support)
  * Manage title, mood, and other metadata
* **Overview**

  * Monthly calendar writing prompts
  * Detailed statistical insights
* **Global Search**

  * `Ctrl/Cmd + K` quick search
  * Combined filtering by keyword, mood, tags, date range, and archives
* **Archive System**

  * Manage people/items/other categories
  * Alias support with automatic search expansion
* **Privacy & Security**

  * App lock (6-digit password / Windows PIN)
  * Auto-lock when idle, synchronized with system lock screen
  * Encrypted SQLite database (SQLCipher)
* **Data Import & Export**

  * One-click ZIP backup
  * Password-protected backups
* **Auto Update**

  * Check, download, and install updates (based on `electron-updater`)

## Tech Stack

* Electron + electron-vite
* Vue 3 + TypeScript + Pinia + Vue Router
* Naive UI + ECharts
* better-sqlite3-multiple-ciphers (SQLCipher)
* sharp (image processing)
* electron-builder (packaging)

## Project Structure

```text
src/
  main/                    # Electron main process (IPC, database, file & security)
    database/              # Data access and migrations
    security/              # Local key management
    utils/                 # Image storage, data import/export
  preload/                 # Secure APIs exposed via contextBridge
  renderer/src/            # Vue frontend
    components/            # Shared components (sidebar, search, editor, etc.)
    views/                 # Pages (dashboard/today/archives/settings)
    stores/                # Pinia state management (theme, privacy, user)
resources/                 # Icons, installation scripts, and static assets
```

## Quick Start

### Requirements

* Node.js `>= 22`
* npm (recommended to use the latest version compatible with your Node.js version)

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

### Preview

```bash
npm run start
```

## Common Scripts

```bash
# Code Quality
npm run lint
npm run format
npm run typecheck

# Build
npm run build
npm run build:unpack
npm run build:win
npm run build:win:msi
npm run build:win:all
npm run build:mac
npm run build:linux

# Release (GitHub Releases)
npm run release
```

## Data & Security Notes

* Application data is stored in the Electron `app.getPath('userData')` directory.
* Key data includes:

  * `diary.db`: Encrypted database (SQLCipher)
  * `images/`, `thumbnails/`: Images and thumbnails
  * `db-key.json`: Local database key file (encrypted and stored using Electron `safeStorage`)
* Exported backups are ZIP files containing the database, attachments, metadata, and encrypted image packages.
* The minimum backup password length is 8 characters.

## Packaging & Installation

### Multi-Platform Build

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

### Silent Installation on Windows

```bash
# NSIS
ShadowDiary-<version>-<os>-<arch>-setup.exe /s

# MSI
msiexec /i ShadowDiary-<version>-<os>-<arch>.msi /qn
```

## License

[MIT](LICENSE)

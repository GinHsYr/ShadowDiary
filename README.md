<h1 align="center">影迹</h1>
<h6 align="center">Shadow Diary</h6>

<p align="center">
  <img src="resources/icon.png" width="140" />
</p>

<h4 align="center">A simple diary app</h4>

## Project Setup

### Requirements

- Node.js >= 20.19.0

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# Windows MSI only
$ npm run build:win:msi

# Windows NSIS + MSI
$ npm run build:win:all

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

### Windows Silent Install

For Microsoft Store submission (Win32 installer command), silent install is supported with `/s`:

```bash
ShadowDiary-<version>-<os>-<arch>-setup.exe /s
```

For MSI silent install, use `msiexec`:

```bash
msiexec /i ShadowDiary-<version>-<os>-<arch>.msi /qn
```

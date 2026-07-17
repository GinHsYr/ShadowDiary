import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nativePackages = ['sharp', 'better-sqlite3-multiple-ciphers']

for (const packageName of nativePackages) {
  try {
    require(packageName)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`无法加载 ${packageName} 的 ${process.platform}-${process.arch} 原生模块。`)
    console.error(detail)
    console.error(
      '请在当前操作系统的独立工作目录中执行 npm ci；不要让 Windows 和 WSL/Linux 共用同一个 node_modules。'
    )
    process.exit(1)
  }
}

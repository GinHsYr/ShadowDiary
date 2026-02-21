import {
  app,
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { checkpointDatabase, closeDatabase, initDatabase } from '../database'
import { invalidatePersonMentionCache } from '../database/diary'
import { ensureImageDirs } from './imageStorage'

const BACKUP_FILE_PREFIX = 'shadow-diary-backup'
const ZIP_FILE_EXTENSION = '.zip'
const EXPORT_DATA_FILE_NAMES = ['diary.db'] as const
const IMPORT_DATA_FILE_NAMES = ['diary.db', 'diary.db-wal', 'diary.db-shm'] as const
const DATA_DIR_NAMES = ['images', 'thumbnails', 'attachments'] as const
const EXPORT_DATA_ITEMS = [...EXPORT_DATA_FILE_NAMES, ...DATA_DIR_NAMES] as const
const IMPORT_DATA_ITEMS = [...IMPORT_DATA_FILE_NAMES, ...DATA_DIR_NAMES] as const

const execFileAsync = promisify(execFile)

let transferInProgress = false

export interface DataTransferResult {
  success: boolean
  canceled?: boolean
  path?: string
  error?: string
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  return `${year}${month}${day}-${hour}${minute}${second}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function copyPathIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) return
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true })
}

async function removePathIfExists(path: string): Promise<void> {
  if (!(await pathExists(path))) return
  await fs.rm(path, { recursive: true, force: true })
}

function ensureZipExtension(filePath: string): string {
  if (filePath.toLowerCase().endsWith(ZIP_FILE_EXTENSION)) return filePath
  return `${filePath}${ZIP_FILE_EXTENSION}`
}

function escapePowerShellSingleQuoted(path: string): string {
  return path.replace(/'/g, "''")
}

async function showZipSavePicker(
  window: BrowserWindow | null | undefined,
  title: string,
  defaultPath: string
): Promise<string | null> {
  const options: SaveDialogOptions = {
    title,
    defaultPath,
    filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
  }

  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return ensureZipExtension(result.filePath)
}

async function showZipOpenPicker(
  window: BrowserWindow | null | undefined,
  title: string
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
  }

  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function collectExistingRelativePaths(
  baseDir: string,
  names: readonly string[]
): Promise<string[]> {
  const existing: string[] = []
  for (const name of names) {
    if (await pathExists(join(baseDir, name))) {
      existing.push(name)
    }
  }
  return existing
}

async function createZipArchiveFromPaths(
  sourceDir: string,
  relativePaths: readonly string[],
  zipFilePath: string
): Promise<void> {
  if (relativePaths.length === 0) {
    throw new Error('没有可导出的数据文件')
  }

  await removePathIfExists(zipFilePath)

  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(sourceDir)
    const escapedTarget = escapePowerShellSingleQuoted(zipFilePath)
    const escapedPaths = relativePaths
      .map((relativePath) => `'${escapePowerShellSingleQuoted(relativePath)}'`)
      .join(', ')
    const command = [
      "$ErrorActionPreference='Stop'",
      `Set-Location -LiteralPath '${escapedSource}'`,
      `Compress-Archive -Path @(${escapedPaths}) -DestinationPath '${escapedTarget}' -Force`
    ].join('; ')
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
    return
  }

  await execFileAsync('zip', ['-r', '-q', zipFilePath, ...relativePaths], { cwd: sourceDir })
}

async function appendMetadataToZip(zipFilePath: string, metadataPath: string): Promise<void> {
  if (!(await pathExists(metadataPath))) return

  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(metadataPath)
    const escapedTarget = escapePowerShellSingleQuoted(zipFilePath)
    const command = `Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Update`
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
    return
  }

  await execFileAsync('zip', ['-q', '-j', zipFilePath, metadataPath])
}

async function extractZipArchive(zipFilePath: string, targetDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(zipFilePath)
    const escapedTarget = escapePowerShellSingleQuoted(targetDir)
    const command = `Expand-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Force`
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
    return
  }

  await execFileAsync('unzip', ['-o', '-q', zipFilePath, '-d', targetDir])
}

async function locateBackupRoot(extractDir: string): Promise<string | null> {
  const pending: Array<{ path: string; depth: number }> = [{ path: extractDir, depth: 0 }]

  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) continue

    if (await pathExists(join(current.path, 'diary.db'))) {
      return current.path
    }

    if (current.depth >= 2) continue

    const entries = await fs.readdir(current.path, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      pending.push({
        path: join(current.path, entry.name),
        depth: current.depth + 1
      })
    }
  }

  return null
}

async function withTransferLock(
  callback: () => Promise<DataTransferResult>
): Promise<DataTransferResult> {
  if (transferInProgress) {
    return {
      success: false,
      error: '已有数据导入/导出任务在进行中，请稍后重试'
    }
  }

  transferInProgress = true
  try {
    return await callback()
  } finally {
    transferInProgress = false
  }
}

async function moveCurrentDataToRollback(
  userDataDir: string,
  rollbackDir: string
): Promise<string[]> {
  const movedItems: string[] = []

  for (const itemName of IMPORT_DATA_ITEMS) {
    const sourcePath = join(userDataDir, itemName)
    if (!(await pathExists(sourcePath))) continue

    await fs.rename(sourcePath, join(rollbackDir, itemName))
    movedItems.push(itemName)
  }

  return movedItems
}

async function restoreRollbackData(
  userDataDir: string,
  rollbackDir: string,
  movedItems: string[]
): Promise<void> {
  for (const itemName of movedItems) {
    const rollbackPath = join(rollbackDir, itemName)
    if (!(await pathExists(rollbackPath))) continue
    await fs.rename(rollbackPath, join(userDataDir, itemName))
  }
}

async function cleanupCurrentData(userDataDir: string): Promise<void> {
  for (const itemName of IMPORT_DATA_ITEMS) {
    await removePathIfExists(join(userDataDir, itemName))
  }
}

async function reopenDatabase(): Promise<void> {
  initDatabase()
  invalidatePersonMentionCache()
  await ensureImageDirs()
}

export async function exportAppData(
  window: BrowserWindow | null | undefined
): Promise<DataTransferResult> {
  return withTransferLock(async () => {
    const defaultBackupName = `${BACKUP_FILE_PREFIX}-${formatTimestamp(new Date())}${ZIP_FILE_EXTENSION}`
    const selectedZipPath = await showZipSavePicker(window, '选择导出 ZIP 文件', defaultBackupName)
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }

    const tempExportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-metadata-`)
    )
    const metadataPath = join(tempExportRoot, 'metadata.json')
    const userDataDir = app.getPath('userData')
    let databaseClosed = false

    try {
      checkpointDatabase('TRUNCATE')
      closeDatabase()
      databaseClosed = true
      const exportPaths = await collectExistingRelativePaths(userDataDir, EXPORT_DATA_ITEMS)

      const metadata = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        exportedAt: new Date().toISOString(),
        backupFormatVersion: 2,
        compression: 'zip'
      }
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

      await createZipArchiveFromPaths(userDataDir, exportPaths, selectedZipPath)
      await appendMetadataToZip(selectedZipPath, metadataPath)
      await reopenDatabase()
      databaseClosed = false

      return {
        success: true,
        path: selectedZipPath
      }
    } catch (error) {
      if (databaseClosed) {
        try {
          await reopenDatabase()
        } catch (reopenError) {
          return {
            success: false,
            error: `导出失败：${String(error)}；数据库重连失败：${String(reopenError)}`
          }
        }
      }

      return {
        success: false,
        error: String(error)
      }
    } finally {
      await removePathIfExists(tempExportRoot)
    }
  })
}

export async function importAppData(
  window: BrowserWindow | null | undefined
): Promise<DataTransferResult> {
  return withTransferLock(async () => {
    const selectedZipPath = await showZipOpenPicker(window, '选择备份 ZIP 文件')
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }

    const tempImportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-import-`)
    )
    const extractedDir = join(tempImportRoot, 'extracted')
    let backupRoot: string | null = null
    try {
      await fs.mkdir(extractedDir, { recursive: true })
      await extractZipArchive(selectedZipPath, extractedDir)
      backupRoot = await locateBackupRoot(extractedDir)
    } catch (error) {
      await removePathIfExists(tempImportRoot)
      return {
        success: false,
        error: `ZIP 解压失败：${String(error)}`
      }
    }

    if (!backupRoot) {
      await removePathIfExists(tempImportRoot)
      return {
        success: false,
        error: 'ZIP 内未找到 diary.db，无法导入'
      }
    }

    const backupDatabasePath = join(backupRoot, 'diary.db')
    if (!(await pathExists(backupDatabasePath))) {
      await removePathIfExists(tempImportRoot)
      return {
        success: false,
        error: 'ZIP 内缺少 diary.db，无法导入'
      }
    }

    const userDataDir = app.getPath('userData')
    const rollbackDir = join(userDataDir, `.restore-rollback-${Date.now()}`)
    let movedItems: string[] = []

    try {
      closeDatabase()

      await fs.mkdir(rollbackDir, { recursive: true })
      movedItems = await moveCurrentDataToRollback(userDataDir, rollbackDir)

      for (const itemName of IMPORT_DATA_ITEMS) {
        await copyPathIfExists(join(backupRoot, itemName), join(userDataDir, itemName))
      }

      try {
        await reopenDatabase()
      } catch (reopenError) {
        await cleanupCurrentData(userDataDir)
        await restoreRollbackData(userDataDir, rollbackDir, movedItems)
        try {
          await reopenDatabase()
        } catch (rollbackReopenError) {
          return {
            success: false,
            error: `备份数据无效：${String(reopenError)}；回滚后数据库重连失败：${String(rollbackReopenError)}`
          }
        }

        await removePathIfExists(rollbackDir)
        return {
          success: false,
          error: `备份数据无效或不兼容：${String(reopenError)}`
        }
      }

      await removePathIfExists(rollbackDir)

      return {
        success: true,
        path: selectedZipPath
      }
    } catch (error) {
      try {
        await cleanupCurrentData(userDataDir)
        await restoreRollbackData(userDataDir, rollbackDir, movedItems)
        await reopenDatabase()
      } catch (restoreError) {
        return {
          success: false,
          error: `导入失败：${String(error)}；回滚失败：${String(restoreError)}`
        }
      }

      await removePathIfExists(rollbackDir)

      return {
        success: false,
        error: String(error)
      }
    } finally {
      await removePathIfExists(tempImportRoot)
    }
  })
}

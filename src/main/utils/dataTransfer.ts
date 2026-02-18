import { app, BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { closeDatabase, initDatabase } from '../database'
import { invalidatePersonMentionCache } from '../database/diary'
import { ensureImageDirs } from './imageStorage'

const BACKUP_FOLDER_PREFIX = 'shadow-diary-backup'
const DATA_FILE_NAMES = ['diary.db', 'diary.db-wal', 'diary.db-shm'] as const
const DATA_DIR_NAMES = ['images', 'thumbnails', 'attachments'] as const
const DATA_ITEMS = [...DATA_FILE_NAMES, ...DATA_DIR_NAMES] as const

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

async function showDirectoryPicker(
  window: BrowserWindow | null | undefined,
  title: string
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'createDirectory']
  }

  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
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

  for (const itemName of DATA_ITEMS) {
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
  for (const itemName of DATA_ITEMS) {
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
    const selectedDir = await showDirectoryPicker(window, '选择导出目录')
    if (!selectedDir) {
      return { success: false, canceled: true }
    }

    const backupDirName = `${BACKUP_FOLDER_PREFIX}-${formatTimestamp(new Date())}`
    const backupDirPath = join(selectedDir, backupDirName)

    try {
      closeDatabase()

      await fs.mkdir(backupDirPath, { recursive: true })

      for (const fileName of DATA_FILE_NAMES) {
        const sourcePath = join(app.getPath('userData'), fileName)
        const targetPath = join(backupDirPath, fileName)
        await copyPathIfExists(sourcePath, targetPath)
      }

      for (const dirName of DATA_DIR_NAMES) {
        const sourcePath = join(app.getPath('userData'), dirName)
        const targetPath = join(backupDirPath, dirName)
        await copyPathIfExists(sourcePath, targetPath)
      }

      const metadata = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        exportedAt: new Date().toISOString(),
        backupFormatVersion: 1
      }
      await fs.writeFile(
        join(backupDirPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
      )

      await reopenDatabase()

      return {
        success: true,
        path: backupDirPath
      }
    } catch (error) {
      try {
        await reopenDatabase()
      } catch (reopenError) {
        return {
          success: false,
          error: `导出失败：${String(error)}；数据库重连失败：${String(reopenError)}`
        }
      }

      return {
        success: false,
        error: String(error)
      }
    }
  })
}

export async function importAppData(
  window: BrowserWindow | null | undefined
): Promise<DataTransferResult> {
  return withTransferLock(async () => {
    const selectedDir = await showDirectoryPicker(window, '选择备份目录')
    if (!selectedDir) {
      return { success: false, canceled: true }
    }

    const backupDatabasePath = join(selectedDir, 'diary.db')
    if (!(await pathExists(backupDatabasePath))) {
      return {
        success: false,
        error: '所选目录缺少 diary.db，无法导入'
      }
    }

    const userDataDir = app.getPath('userData')
    const rollbackDir = join(userDataDir, `.restore-rollback-${Date.now()}`)
    let movedItems: string[] = []

    try {
      closeDatabase()

      await fs.mkdir(rollbackDir, { recursive: true })
      movedItems = await moveCurrentDataToRollback(userDataDir, rollbackDir)

      for (const itemName of DATA_ITEMS) {
        await copyPathIfExists(join(selectedDir, itemName), join(userDataDir, itemName))
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
        path: selectedDir
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
    }
  })
}

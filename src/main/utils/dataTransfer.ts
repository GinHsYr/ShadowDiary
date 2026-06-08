import {
  app,
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'
import { join } from 'path'
import { execFile, type ExecFileOptions } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import {
  checkpointDatabase,
  closeDatabase,
  initDatabase,
  verifyDatabaseFileWithKey
} from '../database'
import { invalidatePersonMentionCache } from '../database/diary'
import {
  BACKUP_KEY_FILE_NAME,
  getLocalDbKeyOrNull,
  getLocalDbKeyOrThrow,
  setLocalDbKeyFromImport
} from '../security/dbKey'
import { isAttachmentRelativePathSafe } from './attachmentPath'
import { ensureImageDirs } from './imageStorage'

const BACKUP_FILE_PREFIX = 'shadow-diary-backup'
const ZIP_FILE_EXTENSION = '.zip'
const METADATA_FILE_NAME = 'metadata.json'
const CURRENT_BACKUP_FORMAT_VERSION = 5
const EXPORT_DATA_FILE_NAMES = ['diary.db'] as const
const IMPORT_DATA_FILE_NAMES = ['diary.db', 'diary.db-wal', 'diary.db-shm'] as const
const IMAGE_DATA_DIR_NAMES = ['images', 'thumbnails'] as const
const PLAIN_DATA_DIR_NAMES = ['attachments'] as const
const EXPORT_DATA_ITEMS = [
  ...EXPORT_DATA_FILE_NAMES,
  ...IMAGE_DATA_DIR_NAMES,
  ...PLAIN_DATA_DIR_NAMES
] as const
const IMPORT_DATA_ITEMS = [
  ...IMPORT_DATA_FILE_NAMES,
  ...IMAGE_DATA_DIR_NAMES,
  ...PLAIN_DATA_DIR_NAMES
] as const
const IMPORT_MAIN_DATA_ITEMS = IMPORT_DATA_ITEMS

const execFileAsync = promisify(execFile)

let transferInProgress = false
let activeTransferController: TransferController | null = null

export type DataTransferErrorCode =
  | 'UNSUPPORTED_BACKUP_FORMAT'
  | 'MISSING_KEY_FILE'
  | 'INVALID_BACKUP'
  | 'TRANSFER_IN_PROGRESS'

export interface DataTransferResult {
  success: boolean
  canceled?: boolean
  path?: string
  error?: string
  errorCode?: DataTransferErrorCode
}

export interface DataTransferOptions {}

export interface DataTransferProgress {
  percent: number
  message: string
}

interface BackupMetadata {
  appName: string
  appVersion: string
  exportedAt: string
  backupFormatVersion: number
  compression: 'zip'
  encryption: {
    db: 'sqlcipher'
    keyFile: 'plain-text'
    attachments: 'plain-zip'
  }
}

interface ImportBackupMetadata {
  imageArchiveIncluded: boolean
}

interface BackupKeyFile {
  version: 1
  format: 'plain-text'
  dbKeyHex: string
}

interface AttachmentPathRow {
  id: string
  file_path: string
}

interface TransferController {
  canceled: boolean
  abortControllers: Set<AbortController>
}

class DataTransferError extends Error {
  readonly code: DataTransferErrorCode

  constructor(code: DataTransferErrorCode, message: string) {
    super(message)
    this.name = 'DataTransferError'
    this.code = code
  }
}

class TransferCanceledError extends Error {
  constructor() {
    super('Data transfer canceled')
    this.name = 'TransferCanceledError'
  }
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

function formatError(error: unknown): DataTransferResult {
  if (error instanceof DataTransferError) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code
    }
  }

  return {
    success: false,
    error: String(error)
  }
}

function isValidDbKeyHex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const abortError = error as { name?: string; code?: string }
  return abortError.name === 'AbortError' || abortError.code === 'ABORT_ERR'
}

function isTransferCanceledError(error: unknown): boolean {
  return error instanceof TransferCanceledError || isAbortError(error)
}

function throwIfTransferCanceled(controller: TransferController): void {
  if (controller.canceled) {
    throw new TransferCanceledError()
  }
}

async function runExecFile(
  file: string,
  args: string[],
  options: ExecFileOptions | undefined,
  controller: TransferController
): Promise<void> {
  throwIfTransferCanceled(controller)
  const abortController = new AbortController()
  controller.abortControllers.add(abortController)

  try {
    await execFileAsync(file, args, { ...options, signal: abortController.signal })
  } catch (error) {
    if (controller.canceled || isAbortError(error)) {
      throw new TransferCanceledError()
    }
    throw error
  } finally {
    controller.abortControllers.delete(abortController)
  }
}

export function cancelDataTransfer(): boolean {
  if (!activeTransferController) return false

  activeTransferController.canceled = true
  for (const abortController of activeTransferController.abortControllers) {
    abortController.abort()
  }
  return true
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function applySqlCipherKeyForImport(db: Database.Database, dbKeyHex: string): void {
  db.pragma(`key = "x'${dbKeyHex}'"`)
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 256000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
}

function assertBackupAttachmentPathsSafe(backupDatabasePath: string, dbKeyHex: string): void {
  const backupDb = new Database(backupDatabasePath, { readonly: true, fileMustExist: true })
  try {
    applySqlCipherKeyForImport(backupDb, dbKeyHex)
    backupDb.prepare('SELECT COUNT(*) as count FROM sqlite_master').get()

    const rows = backupDb
      .prepare('SELECT id, file_path FROM attachments')
      .iterate() as Iterable<AttachmentPathRow>
    for (const row of rows) {
      if (!isAttachmentRelativePathSafe(row.file_path)) {
        throw new DataTransferError(
          'INVALID_BACKUP',
          `备份包含非法附件路径（附件 ID: ${row.id}），导入已中止`
        )
      }
    }
  } catch (error) {
    if (error instanceof DataTransferError) {
      throw error
    }
    throw new DataTransferError('INVALID_BACKUP', `备份附件路径校验失败：${String(error)}`)
  } finally {
    backupDb.close()
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
  zipFilePath: string,
  controller: TransferController
): Promise<void> {
  throwIfTransferCanceled(controller)
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
    await runExecFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      undefined,
      controller
    )
    return
  }

  await runExecFile(
    'zip',
    ['-r', '-q', zipFilePath, ...relativePaths],
    { cwd: sourceDir },
    controller
  )
}

async function extractZipArchive(
  zipFilePath: string,
  targetDir: string,
  controller: TransferController
): Promise<void> {
  throwIfTransferCanceled(controller)
  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(zipFilePath)
    const escapedTarget = escapePowerShellSingleQuoted(targetDir)
    const command = `Expand-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Force`
    await runExecFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      undefined,
      controller
    )
    return
  }

  await runExecFile('unzip', ['-o', '-q', zipFilePath, '-d', targetDir], undefined, controller)
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
  callback: (controller: TransferController) => Promise<DataTransferResult>
): Promise<DataTransferResult> {
  if (transferInProgress) {
    return {
      success: false,
      errorCode: 'TRANSFER_IN_PROGRESS',
      error: '已有数据导入/导出任务在进行中，请稍后重试'
    }
  }

  const controller: TransferController = {
    canceled: false,
    abortControllers: new Set()
  }
  transferInProgress = true
  activeTransferController = controller
  try {
    return await callback(controller)
  } finally {
    activeTransferController = null
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

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, 'utf-8')
  return JSON.parse(raw) as T
}

async function locateOptionalFile(
  backupRoot: string,
  extractedDir: string,
  fileName: string
): Promise<string | null> {
  const candidates = [join(backupRoot, fileName), join(extractedDir, fileName)]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

async function resolveImportMetadata(
  backupRoot: string,
  extractedDir: string
): Promise<ImportBackupMetadata> {
  const metadataPath = await locateOptionalFile(backupRoot, extractedDir, METADATA_FILE_NAME)
  if (!metadataPath) {
    throw new DataTransferError(
      'UNSUPPORTED_BACKUP_FORMAT',
      '备份格式过旧，无法导入（缺少 metadata.json）'
    )
  }

  const metadata = await readJsonFile<Partial<BackupMetadata>>(metadataPath)
  if (metadata.backupFormatVersion !== CURRENT_BACKUP_FORMAT_VERSION) {
    throw new DataTransferError('UNSUPPORTED_BACKUP_FORMAT', '仅支持当前版本生成的免密备份')
  }

  return {
    imageArchiveIncluded: false
  }
}

async function resolveImportDbKey(backupRoot: string, extractedDir: string): Promise<string> {
  const keyFilePath = await locateOptionalFile(backupRoot, extractedDir, BACKUP_KEY_FILE_NAME)
  if (!keyFilePath) {
    throw new DataTransferError('MISSING_KEY_FILE', '备份缺少密钥文件，无法导入')
  }

  const keyFile = await readJsonFile<Partial<BackupKeyFile>>(keyFilePath)
  const dbKeyHex = typeof keyFile.dbKeyHex === 'string' ? keyFile.dbKeyHex.trim() : ''
  if (keyFile.version !== 1 || keyFile.format !== 'plain-text' || !isValidDbKeyHex(dbKeyHex)) {
    throw new DataTransferError('INVALID_BACKUP', '备份密钥文件无效，无法导入')
  }

  return dbKeyHex
}

function buildExportMetadata(): BackupMetadata {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    backupFormatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    compression: 'zip',
    encryption: {
      db: 'sqlcipher',
      keyFile: 'plain-text',
      attachments: 'plain-zip'
    }
  }
}

async function sanitizeBackupDatabase(
  sourcePath: string,
  targetPath: string,
  dbKeyHex: string
): Promise<void> {
  await fs.copyFile(sourcePath, targetPath)

  const backupDb = new Database(targetPath)
  try {
    applySqlCipherKeyForImport(backupDb, dbKeyHex)
    backupDb.prepare('SELECT COUNT(*) as count FROM sqlite_master').get()
    backupDb
      .prepare("DELETE FROM settings WHERE key LIKE 'privacy.%' OR key LIKE 'disguise.%'")
      .run()
    backupDb.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    backupDb.close()
  }
}

async function stageExportFiles(
  userDataDir: string,
  stageDir: string,
  dbKeyHex: string,
  controller: TransferController
): Promise<string[]> {
  const stagedPaths: string[] = []
  const stagedDatabasePath = join(stageDir, 'diary.db')
  await sanitizeBackupDatabase(join(userDataDir, 'diary.db'), stagedDatabasePath, dbKeyHex)
  stagedPaths.push('diary.db')

  const exportPaths = await collectExistingRelativePaths(userDataDir, EXPORT_DATA_ITEMS.slice(1))
  for (const itemName of exportPaths) {
    throwIfTransferCanceled(controller)
    await copyPathIfExists(join(userDataDir, itemName), join(stageDir, itemName))
    stagedPaths.push(itemName)
  }

  return stagedPaths
}

function buildBackupKeyFile(dbKeyHex: string): BackupKeyFile {
  if (!isValidDbKeyHex(dbKeyHex)) {
    throw new DataTransferError('INVALID_BACKUP', '数据库密钥无效，无法导出备份')
  }

  return {
    version: 1,
    format: 'plain-text',
    dbKeyHex
  }
}

function normalizeProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function notifyTransferProgress(
  onProgress: ((progress: DataTransferProgress) => void) | undefined,
  percent: number,
  message: string
): void {
  onProgress?.({
    percent: normalizeProgressPercent(percent),
    message
  })
}

export async function exportAppData(
  window: BrowserWindow | null | undefined,
  _options: DataTransferOptions,
  onProgress?: (progress: DataTransferProgress) => void
): Promise<DataTransferResult> {
  return withTransferLock(async (transferController) => {
    const defaultBackupName = `${BACKUP_FILE_PREFIX}-${formatTimestamp(new Date())}${ZIP_FILE_EXTENSION}`
    const selectedZipPath = await showZipSavePicker(window, '选择导出 ZIP 文件', defaultBackupName)
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }
    notifyTransferProgress(onProgress, 2, '已选择导出路径，正在准备导出任务...')

    const tempExportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-export-`)
    )
    const metadataPath = join(tempExportRoot, METADATA_FILE_NAME)
    const backupKeyPath = join(tempExportRoot, BACKUP_KEY_FILE_NAME)
    const userDataDir = app.getPath('userData')
    let databaseClosed = false

    try {
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 8, '正在读取数据库密钥...')
      const dbKeyHex = getLocalDbKeyOrThrow()
      const keyFile = buildBackupKeyFile(dbKeyHex)

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 18, '正在锁定数据库并准备快照...')
      checkpointDatabase('TRUNCATE')
      closeDatabase()
      databaseClosed = true

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 34, '正在整理备份内容...')
      const stagedPaths = await stageExportFiles(
        userDataDir,
        tempExportRoot,
        dbKeyHex,
        transferController
      )

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 58, '正在写入备份元数据...')
      await fs.writeFile(metadataPath, JSON.stringify(buildExportMetadata(), null, 2), 'utf-8')
      await fs.writeFile(backupKeyPath, JSON.stringify(keyFile, null, 2), 'utf-8')

      const zipEntries = [...stagedPaths, METADATA_FILE_NAME, BACKUP_KEY_FILE_NAME]
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 76, '正在生成备份 ZIP...')
      await createZipArchiveFromPaths(
        tempExportRoot,
        zipEntries,
        selectedZipPath,
        transferController
      )

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 96, '正在恢复数据库连接...')
      await reopenDatabase()
      databaseClosed = false

      notifyTransferProgress(onProgress, 100, '导出完成')
      return {
        success: true,
        path: selectedZipPath
      }
    } catch (error) {
      if (databaseClosed) {
        try {
          await reopenDatabase()
          databaseClosed = false
        } catch (reopenError) {
          return {
            success: false,
            error: `导出失败：${String(error)}；数据库重连失败：${String(reopenError)}`
          }
        }
      }

      if (isTransferCanceledError(error)) {
        notifyTransferProgress(onProgress, 100, '导出已取消')
        return { success: false, canceled: true }
      }

      notifyTransferProgress(onProgress, 100, '导出失败')
      return formatError(error)
    } finally {
      await removePathIfExists(tempExportRoot)
    }
  })
}

export async function importAppData(
  window: BrowserWindow | null | undefined,
  _options: DataTransferOptions,
  onProgress?: (progress: DataTransferProgress) => void
): Promise<DataTransferResult> {
  return withTransferLock(async (transferController) => {
    const selectedZipPath = await showZipOpenPicker(window, '选择备份 ZIP 文件')
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }
    notifyTransferProgress(onProgress, 2, '已选择备份文件，正在准备导入任务...')

    const tempImportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-import-`)
    )
    const extractedDir = join(tempImportRoot, 'extracted')
    let backupRoot: string | null = null

    try {
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 14, '正在解压备份文件...')
      await fs.mkdir(extractedDir, { recursive: true })
      await extractZipArchive(selectedZipPath, extractedDir, transferController)
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 24, '正在定位备份根目录...')
      backupRoot = await locateBackupRoot(extractedDir)
    } catch (error) {
      await removePathIfExists(tempImportRoot)
      if (isTransferCanceledError(error)) {
        notifyTransferProgress(onProgress, 100, '导入已取消')
        return { success: false, canceled: true }
      }
      notifyTransferProgress(onProgress, 100, '导入失败')
      return {
        success: false,
        error: `ZIP 解压失败：${String(error)}`
      }
    }

    if (!backupRoot) {
      await removePathIfExists(tempImportRoot)
      notifyTransferProgress(onProgress, 100, '导入失败')
      return {
        success: false,
        errorCode: 'INVALID_BACKUP',
        error: 'ZIP 内未找到 diary.db，无法导入'
      }
    }

    const backupDatabasePath = join(backupRoot, 'diary.db')
    if (!(await pathExists(backupDatabasePath))) {
      await removePathIfExists(tempImportRoot)
      notifyTransferProgress(onProgress, 100, '导入失败')
      return {
        success: false,
        errorCode: 'INVALID_BACKUP',
        error: 'ZIP 内缺少 diary.db，无法导入'
      }
    }

    try {
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 36, '正在校验备份元数据与密钥...')
      await resolveImportMetadata(backupRoot, extractedDir)
      const importDbKeyHex = await resolveImportDbKey(backupRoot, extractedDir)
      verifyDatabaseFileWithKey(backupDatabasePath, importDbKeyHex)
      assertBackupAttachmentPathsSafe(backupDatabasePath, importDbKeyHex)

      const userDataDir = app.getPath('userData')
      const rollbackDir = join(userDataDir, `.restore-rollback-${Date.now()}`)
      let previousDbKey: string | null = null
      try {
        previousDbKey = getLocalDbKeyOrNull()
      } catch (error) {
        await removePathIfExists(tempImportRoot)
        notifyTransferProgress(onProgress, 100, '导入失败')
        return formatError(error)
      }
      let movedItems: string[] = []

      try {
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 66, '正在切换数据库并准备回滚点...')
        closeDatabase()

        await fs.mkdir(rollbackDir, { recursive: true })
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 74, '正在迁移当前数据到回滚区...')
        movedItems = await moveCurrentDataToRollback(userDataDir, rollbackDir)

        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 82, '正在写入备份数据...')
        for (const itemName of IMPORT_MAIN_DATA_ITEMS) {
          throwIfTransferCanceled(transferController)
          await copyPathIfExists(join(backupRoot, itemName), join(userDataDir, itemName))
        }

        setLocalDbKeyFromImport(importDbKeyHex)

        try {
          notifyTransferProgress(onProgress, 96, '正在重建数据库连接...')
          await reopenDatabase()
        } catch (reopenError) {
          await cleanupCurrentData(userDataDir)
          await restoreRollbackData(userDataDir, rollbackDir, movedItems)
          if (previousDbKey) {
            setLocalDbKeyFromImport(previousDbKey)
          }
          try {
            await reopenDatabase()
          } catch (rollbackReopenError) {
            notifyTransferProgress(onProgress, 100, '导入失败')
            return {
              success: false,
              error: `备份数据无效：${String(reopenError)}；回滚后数据库重连失败：${String(rollbackReopenError)}`
            }
          }

          await removePathIfExists(rollbackDir)
          notifyTransferProgress(onProgress, 100, '导入失败')
          return {
            success: false,
            errorCode: 'INVALID_BACKUP',
            error: `备份数据无效或不兼容：${String(reopenError)}`
          }
        }

        await removePathIfExists(rollbackDir)
        notifyTransferProgress(onProgress, 100, '导入完成')
        return {
          success: true,
          path: selectedZipPath
        }
      } catch (error) {
        try {
          await cleanupCurrentData(userDataDir)
          await restoreRollbackData(userDataDir, rollbackDir, movedItems)
          if (previousDbKey) {
            setLocalDbKeyFromImport(previousDbKey)
          }
          await reopenDatabase()
        } catch (restoreError) {
          notifyTransferProgress(onProgress, 100, '导入失败')
          return {
            success: false,
            error: `导入失败：${String(error)}；回滚失败：${String(restoreError)}`
          }
        }

        await removePathIfExists(rollbackDir)
        if (isTransferCanceledError(error)) {
          notifyTransferProgress(onProgress, 100, '导入已取消')
          return { success: false, canceled: true }
        }
        notifyTransferProgress(onProgress, 100, '导入失败')
        return formatError(error)
      }
    } finally {
      await removePathIfExists(tempImportRoot)
    }
  })
}

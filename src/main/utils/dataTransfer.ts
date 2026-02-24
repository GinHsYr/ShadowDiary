import {
  app,
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { join } from 'path'
import { execFile, type ExecFileOptions } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { path7za } from '7zip-bin'
import {
  checkpointDatabase,
  closeDatabase,
  initDatabase,
  verifyDatabaseFileWithKey
} from '../database'
import { invalidatePersonMentionCache } from '../database/diary'
import {
  BACKUP_KEY_FILE_NAME,
  MIN_BACKUP_PASSWORD_LENGTH,
  buildBackupKeyEnvelope,
  getLocalDbKeyOrNull,
  getLocalDbKeyOrThrow,
  setLocalDbKeyFromImport,
  unwrapBackupKeyEnvelope,
  type BackupKeyEnvelope
} from '../security/dbKey'
import { ensureImageDirs } from './imageStorage'

const BACKUP_FILE_PREFIX = 'shadow-diary-backup'
const ZIP_FILE_EXTENSION = '.zip'
const METADATA_FILE_NAME = 'metadata.json'
const CURRENT_BACKUP_FORMAT_VERSION = 4
const IMAGE_BUNDLE_FILE_NAME = 'images.bundle.zip'
const EXPORT_DATA_FILE_NAMES = ['diary.db'] as const
const IMPORT_DATA_FILE_NAMES = ['diary.db', 'diary.db-wal', 'diary.db-shm'] as const
const IMAGE_DATA_DIR_NAMES = ['images', 'thumbnails'] as const
const PLAIN_DATA_DIR_NAMES = ['attachments'] as const
const EXPORT_DATA_ITEMS = [...EXPORT_DATA_FILE_NAMES, ...PLAIN_DATA_DIR_NAMES] as const
const IMPORT_DATA_ITEMS = [
  ...IMPORT_DATA_FILE_NAMES,
  ...IMAGE_DATA_DIR_NAMES,
  ...PLAIN_DATA_DIR_NAMES
] as const
const IMPORT_MAIN_DATA_ITEMS = [...IMPORT_DATA_FILE_NAMES, ...PLAIN_DATA_DIR_NAMES] as const

const execFileAsync = promisify(execFile)

let transferInProgress = false
let activeTransferController: TransferController | null = null

export type DataTransferErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNSUPPORTED_BACKUP_FORMAT'
  | 'MISSING_KEY_ENVELOPE'
  | 'WRONG_BACKUP_PASSWORD'
  | 'INVALID_BACKUP'
  | 'TRANSFER_IN_PROGRESS'

export interface DataTransferResult {
  success: boolean
  canceled?: boolean
  path?: string
  error?: string
  errorCode?: DataTransferErrorCode
}

export interface DataTransferOptions {
  backupPassword: string
}

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
    keyEnvelope: 'aes-256-gcm+scrypt'
    images: 'zip-aes256'
  }
  imageArchive: {
    fileName: string
    included: boolean
  }
}

interface ImportBackupMetadata {
  imageArchiveFileName: string
  imageArchiveIncluded: boolean
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
    super('数据传输已取消')
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

function assertBackupPassword(backupPassword: string): void {
  if (backupPassword.trim().length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new DataTransferError(
      'VALIDATION_FAILED',
      `备份密码长度至少为 ${MIN_BACKUP_PASSWORD_LENGTH} 位`
    )
  }
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

async function appendFileToZip(
  zipFilePath: string,
  filePath: string,
  controller: TransferController
): Promise<void> {
  throwIfTransferCanceled(controller)
  if (!(await pathExists(filePath))) return

  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(filePath)
    const escapedTarget = escapePowerShellSingleQuoted(zipFilePath)
    const command = `Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Update`
    await runExecFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      undefined,
      controller
    )
    return
  }

  await runExecFile('zip', ['-q', '-j', zipFilePath, filePath], undefined, controller)
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

function normalizeExecStream(stream: unknown): string {
  if (typeof stream === 'string') return stream
  if (Buffer.isBuffer(stream)) return stream.toString('utf-8')
  return ''
}

function getExecErrorDetails(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const withStreams = error as { stdout?: unknown; stderr?: unknown; message?: string }
  const stderr = normalizeExecStream(withStreams.stderr).trim()
  const stdout = normalizeExecStream(withStreams.stdout).trim()
  if (stderr && stdout) return `${stderr}\n${stdout}`
  if (stderr) return stderr
  if (stdout) return stdout
  return withStreams.message || String(error)
}

function isEncryptedArchivePasswordError(error: unknown): boolean {
  const normalized = getExecErrorDetails(error).toLowerCase()
  return (
    normalized.includes('wrong password') || normalized.includes('can not open encrypted archive')
  )
}

async function createEncryptedImageArchive(
  sourceDir: string,
  relativePaths: readonly string[],
  zipFilePath: string,
  password: string,
  controller: TransferController
): Promise<void> {
  throwIfTransferCanceled(controller)
  if (relativePaths.length === 0) {
    throw new Error('没有可导出的图片目录')
  }

  await removePathIfExists(zipFilePath)
  await runExecFile(
    path7za,
    ['a', '-tzip', zipFilePath, ...relativePaths, '-mx=9', '-mem=AES256', `-p${password}`],
    { cwd: sourceDir },
    controller
  )
}

async function extractEncryptedImageArchive(
  archivePath: string,
  targetDir: string,
  password: string,
  controller: TransferController
): Promise<void> {
  try {
    await runExecFile(
      path7za,
      ['x', archivePath, `-o${targetDir}`, '-y', `-p${password}`],
      undefined,
      controller
    )
  } catch (error) {
    if (isTransferCanceledError(error)) {
      throw error
    }
    if (isEncryptedArchivePasswordError(error)) {
      throw new DataTransferError('WRONG_BACKUP_PASSWORD', '备份口令错误，请重试')
    }
    throw new DataTransferError(
      'INVALID_BACKUP',
      `图片加密包解压失败：${getExecErrorDetails(error)}`
    )
  }
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
    throw new DataTransferError('UNSUPPORTED_BACKUP_FORMAT', '仅支持 v4 加密备份')
  }

  const imageArchiveFileName =
    typeof metadata.imageArchive?.fileName === 'string' && metadata.imageArchive.fileName.trim()
      ? metadata.imageArchive.fileName
      : IMAGE_BUNDLE_FILE_NAME
  const imageArchiveIncluded = metadata.imageArchive?.included === true

  return {
    imageArchiveFileName,
    imageArchiveIncluded
  }
}

async function resolveImportDbKey(
  backupRoot: string,
  extractedDir: string,
  backupPassword: string
): Promise<string> {
  const envelopePath = await locateOptionalFile(backupRoot, extractedDir, BACKUP_KEY_FILE_NAME)
  if (!envelopePath) {
    throw new DataTransferError('MISSING_KEY_ENVELOPE', '备份缺少密钥文件，无法导入')
  }

  const envelope = await readJsonFile<BackupKeyEnvelope>(envelopePath)
  try {
    return unwrapBackupKeyEnvelope(backupPassword, envelope)
  } catch (error) {
    throw new DataTransferError('WRONG_BACKUP_PASSWORD', String(error))
  }
}

function buildExportMetadata(imageArchiveIncluded: boolean): BackupMetadata {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    backupFormatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    compression: 'zip',
    encryption: {
      db: 'sqlcipher',
      keyEnvelope: 'aes-256-gcm+scrypt',
      images: 'zip-aes256'
    },
    imageArchive: {
      fileName: IMAGE_BUNDLE_FILE_NAME,
      included: imageArchiveIncluded
    }
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
  options: DataTransferOptions,
  onProgress?: (progress: DataTransferProgress) => void
): Promise<DataTransferResult> {
  return withTransferLock(async (transferController) => {
    try {
      assertBackupPassword(options.backupPassword)
    } catch (error) {
      return formatError(error)
    }

    const defaultBackupName = `${BACKUP_FILE_PREFIX}-${formatTimestamp(new Date())}${ZIP_FILE_EXTENSION}`
    const selectedZipPath = await showZipSavePicker(window, '选择导出 ZIP 文件', defaultBackupName)
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }
    notifyTransferProgress(onProgress, 2, '已选择导出路径，正在准备导出任务...')

    const tempExportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-metadata-`)
    )
    const metadataPath = join(tempExportRoot, METADATA_FILE_NAME)
    const backupKeyPath = join(tempExportRoot, BACKUP_KEY_FILE_NAME)
    const imageBundlePath = join(tempExportRoot, IMAGE_BUNDLE_FILE_NAME)
    const userDataDir = app.getPath('userData')
    let databaseClosed = false

    try {
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 8, '正在读取加密密钥...')
      const dbKeyHex = getLocalDbKeyOrThrow()
      const keyEnvelope = buildBackupKeyEnvelope(options.backupPassword, dbKeyHex)

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 18, '正在锁定数据库并创建快照...')
      checkpointDatabase('TRUNCATE')
      closeDatabase()
      databaseClosed = true

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 30, '正在收集可导出文件...')
      const exportPaths = await collectExistingRelativePaths(userDataDir, EXPORT_DATA_ITEMS)
      const imageExportPaths = await collectExistingRelativePaths(userDataDir, IMAGE_DATA_DIR_NAMES)
      const imageArchiveIncluded = imageExportPaths.length > 0

      if (imageArchiveIncluded) {
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 46, '正在加密图片目录...')
        await createEncryptedImageArchive(
          userDataDir,
          imageExportPaths,
          imageBundlePath,
          options.backupPassword,
          transferController
        )
      }

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 60, '正在写入备份元数据...')
      const metadata = buildExportMetadata(imageArchiveIncluded)
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')
      await fs.writeFile(backupKeyPath, JSON.stringify(keyEnvelope, null, 2), 'utf-8')

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 74, '正在生成主备份 ZIP...')
      await createZipArchiveFromPaths(userDataDir, exportPaths, selectedZipPath, transferController)

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 84, '正在追加 metadata.json...')
      await appendFileToZip(selectedZipPath, metadataPath, transferController)

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 90, '正在追加备份密钥...')
      await appendFileToZip(selectedZipPath, backupKeyPath, transferController)
      if (imageArchiveIncluded) {
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 96, '正在追加图片加密包...')
        await appendFileToZip(selectedZipPath, imageBundlePath, transferController)
      }

      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 99, '正在恢复数据库连接...')
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
  options: DataTransferOptions,
  onProgress?: (progress: DataTransferProgress) => void
): Promise<DataTransferResult> {
  return withTransferLock(async (transferController) => {
    try {
      assertBackupPassword(options.backupPassword)
    } catch (error) {
      return formatError(error)
    }

    const selectedZipPath = await showZipOpenPicker(window, '选择备份 ZIP 文件')
    if (!selectedZipPath) {
      return { success: false, canceled: true }
    }
    notifyTransferProgress(onProgress, 2, '已选择备份文件，正在准备导入任务...')

    const tempImportRoot = await fs.mkdtemp(
      join(app.getPath('temp'), `${BACKUP_FILE_PREFIX}-import-`)
    )
    const extractedDir = join(tempImportRoot, 'extracted')
    const decryptedImageDir = join(tempImportRoot, 'images')
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

    let importMetadata: ImportBackupMetadata
    let importDbKeyHex = ''
    try {
      throwIfTransferCanceled(transferController)
      notifyTransferProgress(onProgress, 36, '正在校验备份元数据与密钥...')
      importMetadata = await resolveImportMetadata(backupRoot, extractedDir)
      importDbKeyHex = await resolveImportDbKey(backupRoot, extractedDir, options.backupPassword)
      verifyDatabaseFileWithKey(backupDatabasePath, importDbKeyHex)
    } catch (error) {
      await removePathIfExists(tempImportRoot)
      if (isTransferCanceledError(error)) {
        notifyTransferProgress(onProgress, 100, '导入已取消')
        return { success: false, canceled: true }
      }
      notifyTransferProgress(onProgress, 100, '导入失败')
      return formatError(error)
    }

    if (importMetadata.imageArchiveIncluded) {
      const imageArchivePath = await locateOptionalFile(
        backupRoot,
        extractedDir,
        importMetadata.imageArchiveFileName
      )
      if (!imageArchivePath) {
        await removePathIfExists(tempImportRoot)
        notifyTransferProgress(onProgress, 100, '导入失败')
        return {
          success: false,
          errorCode: 'INVALID_BACKUP',
          error: `备份缺少图片加密包：${importMetadata.imageArchiveFileName}`
        }
      }

      try {
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 52, '正在解密图片数据...')
        await fs.mkdir(decryptedImageDir, { recursive: true })
        await extractEncryptedImageArchive(
          imageArchivePath,
          decryptedImageDir,
          options.backupPassword,
          transferController
        )
      } catch (error) {
        await removePathIfExists(tempImportRoot)
        if (isTransferCanceledError(error)) {
          notifyTransferProgress(onProgress, 100, '导入已取消')
          return { success: false, canceled: true }
        }
        notifyTransferProgress(onProgress, 100, '导入失败')
        return formatError(error)
      }
    }

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
      notifyTransferProgress(onProgress, 82, '正在写入主数据...')
      for (const itemName of IMPORT_MAIN_DATA_ITEMS) {
        throwIfTransferCanceled(transferController)
        await copyPathIfExists(join(backupRoot, itemName), join(userDataDir, itemName))
      }
      if (importMetadata.imageArchiveIncluded) {
        throwIfTransferCanceled(transferController)
        notifyTransferProgress(onProgress, 88, '正在写入图片数据...')
        for (const itemName of IMAGE_DATA_DIR_NAMES) {
          throwIfTransferCanceled(transferController)
          await copyPathIfExists(join(decryptedImageDir, itemName), join(userDataDir, itemName))
        }
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
    } finally {
      await removePathIfExists(tempImportRoot)
    }
  })
}

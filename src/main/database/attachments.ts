import { randomUUID } from 'crypto'
import { getDatabase } from './index'
import { app, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const ATTACHMENTS_DIR = 'attachments'

interface AttachmentRow {
  id: string
  diary_id: string
  filename: string
  mime_type: string
  file_path: string
  size: number
  created_at: number
}

export interface AttachmentInfo {
  id: string
  diaryId: string
  filename: string
  mimeType: string
  filePath: string
  size: number
  createdAt: number
}

function rowToAttachment(row: AttachmentRow): AttachmentInfo {
  return {
    id: row.id,
    diaryId: row.diary_id,
    filename: row.filename,
    mimeType: row.mime_type,
    filePath: row.file_path,
    size: row.size,
    createdAt: row.created_at
  }
}

async function ensureAttachmentsDir(): Promise<string> {
  const dir = join(app.getPath('userData'), ATTACHMENTS_DIR)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function addAttachment(diaryId: string): Promise<AttachmentInfo | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    title: '选择附件'
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const sourcePath = result.filePaths[0]
  const stat = await fs.stat(sourcePath)
  const originalName = sourcePath.split(/[\\/]/).pop() || 'file'
  const ext = originalName.includes('.') ? '.' + originalName.split('.').pop() : ''

  const id = randomUUID()
  const storedName = `${id}${ext}`
  const dir = await ensureAttachmentsDir()
  const destPath = join(dir, storedName)

  await fs.copyFile(sourcePath, destPath)

  const relativePath = `${ATTACHMENTS_DIR}/${storedName}`
  const mimeType = getMimeType(ext)
  const now = Date.now()

  const db = getDatabase()
  db.prepare(
    'INSERT INTO attachments (id, diary_id, filename, mime_type, file_path, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, diaryId, originalName, mimeType, relativePath, stat.size, now)

  return {
    id,
    diaryId,
    filename: originalName,
    mimeType,
    filePath: relativePath,
    size: stat.size,
    createdAt: now
  }
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
    | AttachmentRow
    | undefined
  if (!row) return false

  await deleteAttachmentFiles([row.file_path])

  const result = db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
  return result.changes > 0
}

export function getAttachments(diaryId: string): AttachmentInfo[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM attachments WHERE diary_id = ? ORDER BY created_at')
    .all(diaryId) as AttachmentRow[]
  return rows.map(rowToAttachment)
}

export async function deleteAttachmentFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return

  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const fullPath = join(app.getPath('userData'), filePath)
        await fs.unlink(fullPath)
      } catch {
        // File may already be deleted, continue
      }
    })
  )
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain'
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

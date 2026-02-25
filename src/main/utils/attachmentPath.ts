import { join } from 'path'
import { assertPathInSubdir } from './pathSecurity'

export const ATTACHMENTS_DIR_NAME = 'attachments'

const ATTACHMENT_PATH_PREFIX = `${ATTACHMENTS_DIR_NAME}/`
const UUID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const ATTACHMENT_STORED_NAME_RE = new RegExp(`^${UUID_PATTERN}(?:\\.[a-z0-9]+)?$`, 'i')

export function normalizeAttachmentRelativePath(filePath: string): string | null {
  if (typeof filePath !== 'string') return null

  const normalized = filePath.replace(/\\/g, '/')
  if (!normalized.startsWith(ATTACHMENT_PATH_PREFIX)) return null

  const storedName = normalized.slice(ATTACHMENT_PATH_PREFIX.length)
  if (!ATTACHMENT_STORED_NAME_RE.test(storedName)) return null

  return `${ATTACHMENT_PATH_PREFIX}${storedName}`
}

export function isAttachmentRelativePathSafe(filePath: string): boolean {
  return normalizeAttachmentRelativePath(filePath) !== null
}

export function resolveAttachmentPathFromUserData(
  userDataDir: string,
  filePath: string
): string | null {
  const normalized = normalizeAttachmentRelativePath(filePath)
  if (!normalized) return null

  const storedName = normalized.slice(ATTACHMENT_PATH_PREFIX.length)
  const attachmentsDir = join(userDataDir, ATTACHMENTS_DIR_NAME)
  try {
    return assertPathInSubdir(attachmentsDir, storedName)
  } catch {
    return null
  }
}

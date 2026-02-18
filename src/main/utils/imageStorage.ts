import { app } from 'electron'
import { extname, isAbsolute, join, relative, resolve } from 'path'
import { writeFile, mkdir, readFile, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import sharp from 'sharp'

// 图片存储目录
const getImageDir = (): string => {
  return join(app.getPath('userData'), 'images')
}

// 缩略图存储目录
const getThumbnailDir = (): string => {
  return join(app.getPath('userData'), 'thumbnails')
}

const UUID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const IMAGE_FILENAME_RE = new RegExp(`^${UUID_PATTERN}\\.(jpg|jpeg|png|gif|webp|bmp|svg)$`)
const THUMBNAIL_FILENAME_RE = new RegExp(`^${UUID_PATTERN}_thumb\\.webp$`)
const IMAGE_DATA_URL_RE = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i

const IMAGE_MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
} as const

type SupportedImageExtension = keyof typeof IMAGE_MIME_BY_EXT

const SUBTYPE_TO_EXTENSION: Record<string, SupportedImageExtension> = {
  jpg: 'jpg',
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  'svg+xml': 'svg'
}

export interface ParsedImageDataUrl {
  mimeType: string
  ext: SupportedImageExtension
  buffer: Buffer
}

function normalizeImageExtension(ext: string): SupportedImageExtension | null {
  const normalized = ext.trim().toLowerCase()
  if (!normalized) return null
  return normalized in IMAGE_MIME_BY_EXT ? (normalized as SupportedImageExtension) : null
}

function resolveImageExtensionFromSubtype(subtype: string): SupportedImageExtension | null {
  const normalizedSubtype = subtype.trim().toLowerCase()
  if (!normalizedSubtype) return null

  const direct = SUBTYPE_TO_EXTENSION[normalizedSubtype]
  if (direct) return direct

  const stripped = normalizedSubtype.split('+')[0]
  return normalizeImageExtension(stripped)
}

export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | null {
  const matches = IMAGE_DATA_URL_RE.exec(dataUrl)
  if (!matches) return null

  const subtype = matches[1]
  const data = matches[2]
  const ext = resolveImageExtensionFromSubtype(subtype)
  if (!ext) return null

  const mimeType = IMAGE_MIME_BY_EXT[ext]
  const buffer = Buffer.from(data, 'base64')
  return { mimeType, ext, buffer }
}

function isPathInsideDir(filePath: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(filePath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

// 确保目录存在
export async function ensureImageDirs(): Promise<void> {
  const imageDir = getImageDir()
  const thumbnailDir = getThumbnailDir()

  await Promise.all([
    mkdir(imageDir, { recursive: true }),
    mkdir(thumbnailDir, { recursive: true })
  ])
}

async function saveImageBuffer(
  imageBuffer: Buffer,
  ext: SupportedImageExtension
): Promise<{ id: string; path: string; thumbnailPath: string }> {
  await ensureImageDirs()

  // 生成唯一 ID
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const thumbnailFilename = `${id}_thumb.webp`

  const imagePath = join(getImageDir(), filename)
  const thumbnailPath = join(getThumbnailDir(), thumbnailFilename)

  // 保存原图
  await writeFile(imagePath, imageBuffer)

  // 生成缩略图 (最大宽度 400px，使用 webp 格式)
  try {
    await sharp(imageBuffer)
      .resize(400, null, {
        withoutEnlargement: true,
        fit: 'inside'
      })
      .webp({ quality: 80 })
      .toFile(thumbnailPath)
  } catch (error) {
    console.error('生成缩略图失败:', error)
    // 如果缩略图生成失败，使用原图
  }

  return {
    id,
    path: `diary-image://${filename}`,
    thumbnailPath: `diary-image://${thumbnailFilename}`
  }
}

// 保存图片并生成缩略图
export async function saveImage(
  base64Data: string
): Promise<{ id: string; path: string; thumbnailPath: string }> {
  const parsed = parseImageDataUrl(base64Data)
  if (!parsed) {
    throw new Error('Invalid base64 image data')
  }

  return await saveImageBuffer(parsed.buffer, parsed.ext)
}

export async function saveImageFromFile(
  filePath: string
): Promise<{ id: string; path: string; thumbnailPath: string }> {
  const ext = normalizeImageExtension(extname(filePath).slice(1))
  if (!ext) {
    throw new Error('Unsupported image extension')
  }

  const buffer = await readFile(filePath)
  return await saveImageBuffer(buffer, ext)
}

// 保存档案头像：自动 1:1 裁切，仅保留 webp 缩略图
export async function saveArchiveAvatarFromFile(
  filePath: string
): Promise<{ id: string; path: string; thumbnailPath: string }> {
  await ensureImageDirs()

  const id = randomUUID()
  const thumbnailFilename = `${id}_thumb.webp`
  const thumbnailPath = join(getThumbnailDir(), thumbnailFilename)

  const buffer = await readFile(filePath)
  await sharp(buffer)
    .resize(400, 400, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true
    })
    .webp({ quality: 82 })
    .toFile(thumbnailPath)

  const url = `diary-image://${thumbnailFilename}`
  return {
    id,
    path: url,
    thumbnailPath: url
  }
}

// 读取图片文件
export async function getImage(filename: string): Promise<Buffer> {
  const isThumbnail = THUMBNAIL_FILENAME_RE.test(filename)
  const isImage = IMAGE_FILENAME_RE.test(filename)
  if (!isThumbnail && !isImage) {
    throw new Error('Invalid image filename')
  }

  const dir = isThumbnail ? getThumbnailDir() : getImageDir()
  const filePath = resolve(dir, filename)
  if (!isPathInsideDir(filePath, dir)) {
    throw new Error('Invalid image path')
  }

  if (!existsSync(filePath)) {
    throw new Error('Image not found')
  }

  return await readFile(filePath)
}

// 删除图片及其缩略图
export async function deleteImage(filename: string): Promise<void> {
  const imagePath = join(getImageDir(), filename)
  const id = filename.split('.')[0]
  const thumbnailPath = join(getThumbnailDir(), `${id}_thumb.webp`)

  try {
    if (existsSync(imagePath)) {
      await unlink(imagePath)
    }
    if (existsSync(thumbnailPath)) {
      await unlink(thumbnailPath)
    }
  } catch (error) {
    console.error('删除图片失败:', error)
  }
}

// 从文本内容中提取所有 diary-image ID（支持原图和 _thumb 缩略图）
export function extractImageIds(html: string): string[] {
  const regex = /diary-image:\/\/([a-f0-9-]+)(?:_thumb)?\.[a-z0-9]+/gi
  const ids: string[] = []
  let match

  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1])
  }

  return ids
}

// 清理未使用的图片
export async function cleanupUnusedImages(usedIds: Set<string>): Promise<void> {
  await ensureImageDirs()

  const [imageFiles, thumbnailFiles] = await Promise.all([
    readdir(getImageDir()),
    readdir(getThumbnailDir())
  ])

  for (const file of imageFiles) {
    // 提取图片 ID (文件名格式: {uuid}.{ext})
    const match = file.match(/^([a-f0-9-]+)\.\w+$/)
    if (!match) continue

    const id = match[1]
    if (!usedIds.has(id)) {
      await deleteImage(file)
    }
  }

  for (const file of thumbnailFiles) {
    const match = file.match(/^([a-f0-9-]+)_thumb\.webp$/)
    if (!match) continue

    const id = match[1]
    if (!usedIds.has(id)) {
      const thumbnailPath = join(getThumbnailDir(), file)
      try {
        if (existsSync(thumbnailPath)) {
          await unlink(thumbnailPath)
        }
      } catch (error) {
        console.error('删除缩略图失败:', error)
      }
    }
  }
}

import { app } from 'electron'
import { join } from 'path'
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

// 确保目录存在
export async function ensureImageDirs(): Promise<void> {
  const imageDir = getImageDir()
  const thumbnailDir = getThumbnailDir()

  await Promise.all([
    mkdir(imageDir, { recursive: true }),
    mkdir(thumbnailDir, { recursive: true })
  ])
}

// 保存图片并生成缩略图
export async function saveImage(
  base64Data: string
): Promise<{ id: string; path: string; thumbnailPath: string }> {
  await ensureImageDirs()

  // 解析 base64 数据
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid base64 image data')
  }

  const ext = matches[1]
  const data = matches[2]
  const buffer = Buffer.from(data, 'base64')

  // 生成唯一 ID
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const thumbnailFilename = `${id}_thumb.webp`

  const imagePath = join(getImageDir(), filename)
  const thumbnailPath = join(getThumbnailDir(), thumbnailFilename)

  // 保存原图
  await writeFile(imagePath, buffer)

  // 生成缩略图 (最大宽度 400px，使用 webp 格式)
  try {
    await sharp(buffer)
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

// 读取图片文件
export async function getImage(filename: string): Promise<Buffer> {
  // 检查是否是缩略图
  const isThumbnail = filename.includes('_thumb')
  const dir = isThumbnail ? getThumbnailDir() : getImageDir()
  const filePath = join(dir, filename)

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

// 从 HTML 内容中提取所有图片 ID
export function extractImageIds(html: string): string[] {
  const regex = /diary-image:\/\/([a-f0-9-]+)\.\w+/g
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

  const imageDir = getImageDir()
  const files = await readdir(imageDir)

  for (const file of files) {
    // 提取图片 ID (文件名格式: {uuid}.{ext})
    const match = file.match(/^([a-f0-9-]+)\.\w+$/)
    if (!match) continue

    const id = match[1]
    if (!usedIds.has(id)) {
      await deleteImage(file)
    }
  }
}

import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const LOCAL_DB_KEY_FILE_NAME = 'db-key.json'
export const BACKUP_KEY_FILE_NAME = 'backup-key.json'
export const MIN_BACKUP_PASSWORD_LENGTH = 8
const DB_KEY_BYTES = 32

const SCRYPT_PARAMS = {
  N: 1 << 15,
  r: 8,
  p: 1,
  keyLen: 32
} as const

interface LocalDbKeyFile {
  version: 1
  encryptedKey: string
}

export interface BackupKeyEnvelope {
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  authTag: string
  ciphertext: string
  scrypt: {
    N: number
    r: number
    p: number
    keyLen: number
  }
}

function getLocalDbKeyPath(): string {
  return join(app.getPath('userData'), LOCAL_DB_KEY_FILE_NAME)
}

function isValidDbKeyHex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

function assertValidDbKeyHex(value: string): void {
  if (!isValidDbKeyHex(value)) {
    throw new Error('数据库密钥格式无效')
  }
}

function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不可用安全存储，无法启用数据库加密')
  }
}

function encryptDbKeyForLocalStorage(dbKeyHex: string): string {
  assertSafeStorageAvailable()
  const encrypted = safeStorage.encryptString(dbKeyHex)
  return encrypted.toString('base64')
}

function decryptDbKeyFromLocalStorage(payloadBase64: string): string {
  assertSafeStorageAvailable()
  const encrypted = Buffer.from(payloadBase64, 'base64')
  return safeStorage.decryptString(encrypted)
}

export function hasLocalDbKey(): boolean {
  return existsSync(getLocalDbKeyPath())
}

export function createRandomDbKeyHex(): string {
  return randomBytes(DB_KEY_BYTES).toString('hex')
}

export function storeLocalDbKey(dbKeyHex: string): void {
  assertValidDbKeyHex(dbKeyHex)
  const keyFile: LocalDbKeyFile = {
    version: 1,
    encryptedKey: encryptDbKeyForLocalStorage(dbKeyHex)
  }
  writeFileSync(getLocalDbKeyPath(), JSON.stringify(keyFile, null, 2), 'utf-8')
}

export function getLocalDbKeyOrNull(): string | null {
  const keyPath = getLocalDbKeyPath()
  if (!existsSync(keyPath)) return null

  let parsed: Partial<LocalDbKeyFile>
  try {
    parsed = JSON.parse(readFileSync(keyPath, 'utf-8')) as Partial<LocalDbKeyFile>
  } catch {
    throw new Error('数据库密钥文件损坏，无法读取')
  }

  if (parsed.version !== 1 || typeof parsed.encryptedKey !== 'string' || !parsed.encryptedKey) {
    throw new Error('数据库密钥文件格式不受支持')
  }

  const dbKeyHex = decryptDbKeyFromLocalStorage(parsed.encryptedKey).trim()
  assertValidDbKeyHex(dbKeyHex)
  return dbKeyHex
}

export function getLocalDbKeyOrThrow(): string {
  const dbKey = getLocalDbKeyOrNull()
  if (!dbKey) {
    throw new Error('未找到数据库密钥')
  }
  return dbKey
}

export function ensureLocalDbKey(): string {
  const existing = getLocalDbKeyOrNull()
  if (existing) return existing
  const dbKey = createRandomDbKeyHex()
  storeLocalDbKey(dbKey)
  return dbKey
}

export function setLocalDbKeyFromImport(dbKeyHex: string): void {
  storeLocalDbKey(dbKeyHex)
}

export function clearLocalDbKey(): void {
  rmSync(getLocalDbKeyPath(), { force: true })
}

function assertBackupPassword(value: string): void {
  if (value.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`备份密码长度至少为 ${MIN_BACKUP_PASSWORD_LENGTH} 位`)
  }
}

export function buildBackupKeyEnvelope(password: string, dbKeyHex: string): BackupKeyEnvelope {
  assertBackupPassword(password)
  assertValidDbKeyHex(dbKeyHex)

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kek = scryptSync(password, salt, SCRYPT_PARAMS.keyLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024
  })
  const cipher = createCipheriv('aes-256-gcm', kek, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(dbKeyHex, 'hex')), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    scrypt: { ...SCRYPT_PARAMS }
  }
}

export function unwrapBackupKeyEnvelope(password: string, envelope: BackupKeyEnvelope): string {
  assertBackupPassword(password)

  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'scrypt') {
    throw new Error('不支持的备份密钥封装格式')
  }

  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const authTag = Buffer.from(envelope.authTag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')

  const kek = scryptSync(password, salt, envelope.scrypt.keyLen, {
    N: envelope.scrypt.N,
    r: envelope.scrypt.r,
    p: envelope.scrypt.p,
    maxmem: 64 * 1024 * 1024
  })

  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, iv)
    decipher.setAuthTag(authTag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const dbKeyHex = plain.toString('hex')
    assertValidDbKeyHex(dbKeyHex)
    return dbKeyHex
  } catch {
    throw new Error('备份密码错误或备份密钥文件损坏')
  }
}

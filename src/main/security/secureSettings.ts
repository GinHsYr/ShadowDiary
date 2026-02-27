import { safeStorage } from 'electron'

export interface EncryptedSecretPayloadV1 {
  version: 1
  algorithm: 'safeStorage'
  ciphertext: string
}

function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不可用安全存储，无法加密保存 API Key')
  }
}

export function isEncryptedSecretPayload(value: unknown): value is EncryptedSecretPayloadV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<EncryptedSecretPayloadV1>
  return (
    payload.version === 1 &&
    payload.algorithm === 'safeStorage' &&
    typeof payload.ciphertext === 'string' &&
    payload.ciphertext.length > 0
  )
}

export function encryptSecret(value: string): EncryptedSecretPayloadV1 {
  assertSafeStorageAvailable()
  const encrypted = safeStorage.encryptString(value)
  return {
    version: 1,
    algorithm: 'safeStorage',
    ciphertext: encrypted.toString('base64')
  }
}

export function decryptSecret(payload: EncryptedSecretPayloadV1): string {
  assertSafeStorageAvailable()
  const encrypted = Buffer.from(payload.ciphertext, 'base64')
  return safeStorage.decryptString(encrypted)
}

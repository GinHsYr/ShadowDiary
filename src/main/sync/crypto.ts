import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject
} from 'crypto'

export interface EphemeralKeyPair {
  privateKey: KeyObject
  publicKey: string
}

export function createEphemeralKeyPair(): EphemeralKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const jwk = publicKey.export({ format: 'jwk' })
  if (!jwk.x) throw new Error('x25519_public_key_unavailable')
  return { privateKey, publicKey: base64UrlToBase64(jwk.x) }
}

export function derivePairingKey(options: {
  privateKey: KeyObject
  remotePublicKey: string
  pairingCode: string
  nonce: Buffer
}): Buffer {
  const remoteRaw = Buffer.from(options.remotePublicKey, 'base64')
  if (remoteRaw.byteLength !== 32) throw new Error('invalid_x25519_public_key')
  const remoteKey = createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: base64ToBase64Url(remoteRaw.toString('base64')) },
    format: 'jwk'
  })
  const shared = diffieHellman({ privateKey: options.privateKey, publicKey: remoteKey })
  const codeHash = createHash('sha256').update(options.pairingCode, 'utf8').digest()
  const salt = createHmac('sha256', codeHash).update(options.nonce).digest()
  return Buffer.from(hkdfSync('sha256', shared, salt, 'shadowdiary-pair-v1', 32))
}

export function deriveSessionKey(sharedSecret: Uint8Array, nonce: Uint8Array): Buffer {
  return Buffer.from(
    hkdfSync('sha256', sharedSecret, nonce, Buffer.from('shadowdiary-sync-v1'), 32)
  )
}

export function createProof(key: Uint8Array, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('base64')
}

export function verifyProof(key: Uint8Array, value: string, encodedProof: string): boolean {
  let received: Buffer
  try {
    received = Buffer.from(encodedProof, 'base64')
  } catch {
    return false
  }
  const expected = createHmac('sha256', key).update(value, 'utf8').digest()
  return received.byteLength === expected.byteLength && timingSafeEqual(received, expected)
}

export class SyncSessionCipher {
  private readonly key: Buffer
  private outgoingSequence = 0
  private incomingSequence = 0

  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new Error('invalid_sync_session_key')
    this.key = Buffer.from(key)
  }

  encrypt(message: Record<string, unknown>): string {
    const sequence = ++this.outgoingSequence
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(`shadowdiary-sync-v1:${sequence}`, 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), 'utf8'),
      cipher.final()
    ])
    return JSON.stringify({
      kind: 'encrypted',
      sequence,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    })
  }

  decrypt(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string' || raw.length > 48 * 1024 * 1024) {
      throw new Error('invalid_encrypted_frame')
    }
    const frame: unknown = JSON.parse(raw)
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new Error('invalid_encrypted_frame')
    }
    const value = frame as Record<string, unknown>
    const sequence = Number(value.sequence)
    if (value.kind !== 'encrypted' || sequence !== this.incomingSequence + 1) {
      throw new Error('replayed_encrypted_frame')
    }
    const nonce = Buffer.from(String(value.nonce), 'base64')
    const ciphertext = Buffer.from(String(value.ciphertext), 'base64')
    const tag = Buffer.from(String(value.tag), 'base64')
    if (nonce.byteLength !== 12 || tag.byteLength !== 16) {
      throw new Error('invalid_encrypted_frame')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce)
    decipher.setAAD(Buffer.from(`shadowdiary-sync-v1:${sequence}`, 'utf8'))
    decipher.setAuthTag(tag)
    const cleartext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    )
    const message: unknown = JSON.parse(cleartext)
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('invalid_encrypted_payload')
    }
    this.incomingSequence = sequence
    return message as Record<string, unknown>
  }
}

function base64ToBase64Url(value: string): string {
  return value.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
}

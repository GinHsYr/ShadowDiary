import { describe, expect, it } from 'vitest'
import {
  createEphemeralKeyPair,
  createProof,
  derivePairingKey,
  deriveSessionKey,
  SyncSessionCipher,
  verifyProof
} from '../crypto'

describe('sync cryptography', () => {
  it('derives the same pairing key on both X25519 peers', () => {
    const client = createEphemeralKeyPair()
    const server = createEphemeralKeyPair()
    const nonce = Buffer.alloc(32, 9)
    const clientKey = derivePairingKey({
      privateKey: client.privateKey,
      remotePublicKey: server.publicKey,
      pairingCode: '183204',
      nonce
    })
    const serverKey = derivePairingKey({
      privateKey: server.privateKey,
      remotePublicKey: client.publicKey,
      pairingCode: '183204',
      nonce
    })

    expect(clientKey.equals(serverKey)).toBe(true)
    expect(clientKey).toHaveLength(32)
  })

  it('round-trips authenticated frames and rejects replay', () => {
    const key = deriveSessionKey(Buffer.alloc(32, 4), Buffer.alloc(32, 7))
    const sender = new SyncSessionCipher(key)
    const receiver = new SyncSessionCipher(key)
    const frame = sender.encrypt({ kind: 'syncSnapshot', title: 'Quiet day' })

    expect(receiver.decrypt(frame)).toEqual({ kind: 'syncSnapshot', title: 'Quiet day' })
    expect(() => receiver.decrypt(frame)).toThrow('replayed_encrypted_frame')
  })

  it('rejects tampered authentication tags', () => {
    const key = Buffer.alloc(32, 8)
    const sender = new SyncSessionCipher(key)
    const receiver = new SyncSessionCipher(key)
    const frame = JSON.parse(sender.encrypt({ kind: 'syncComplete' })) as Record<string, unknown>
    const tag = Buffer.from(String(frame.tag), 'base64')
    tag[0] ^= 0xff
    frame.tag = tag.toString('base64')

    expect(() => receiver.decrypt(JSON.stringify(frame))).toThrow()
  })

  it('binds authentication proofs to the complete transcript', () => {
    const key = Buffer.alloc(32, 3)
    const proof = createProof(key, 'client|nonce|desktop')
    expect(verifyProof(key, 'client|nonce|desktop', proof)).toBe(true)
    expect(verifyProof(key, 'client|other|desktop', proof)).toBe(false)
  })
})

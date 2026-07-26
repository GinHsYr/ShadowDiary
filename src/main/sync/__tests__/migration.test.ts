import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('LAN sync database migration', () => {
  it('declares version 9 synchronization metadata and conflict tables', () => {
    // The production SQLite binding targets Electron's Node ABI, while Vitest
    // runs under the host Node ABI. Verify the checked-in migration source here;
    // Electron's production build exercises the compiled migration module.
    const source = readFileSync(new URL('../../database/migrations.ts', import.meta.url), 'utf8')

    expect(source).toContain('Version 9: Add LAN synchronization metadata')
    expect(source).toContain('CREATE TABLE sync_devices')
    expect(source).toContain('CREATE TABLE sync_records')
    expect(source).toContain('CREATE TABLE sync_conflicts')
    expect(source).toContain('CREATE INDEX idx_sync_records_deleted')
  })
})

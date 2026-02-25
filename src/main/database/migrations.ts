import type Database from 'better-sqlite3'

type Migration = (db: Database.Database) => void

/**
 * Strip HTML tags and decode common entities to plain text.
 * Used both in migrations (backfill) and kept here for reuse.
 */
export function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const DIARY_IMAGE_ID_RE = /diary-image:\/\/([a-f0-9-]+)(?:_thumb)?\.[a-z0-9]+/gi
const DIARY_IMAGE_PATH_RE = /diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+/gi
const DIARY_IMAGE_PATH_FULL_RE = /^diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+$/i

interface MigrationImagePathCandidate {
  imagePath?: string
  previewPath?: string
}

function extractImageIdsForMigration(value: string | null | undefined): Set<string> {
  const imageIds = new Set<string>()
  if (!value) return imageIds

  let match: RegExpExecArray | null
  DIARY_IMAGE_ID_RE.lastIndex = 0
  while ((match = DIARY_IMAGE_ID_RE.exec(value)) !== null) {
    imageIds.add(match[1])
  }
  DIARY_IMAGE_ID_RE.lastIndex = 0

  return imageIds
}

function createFallbackPreviewPathForMigration(imageId: string): string {
  return `diary-image://${imageId}_thumb.webp`
}

function parseImagePathForMigration(path: string | null | undefined): {
  imageId: string
  isThumbnail: boolean
  normalizedPath: string
} | null {
  if (!path) return null
  const trimmed = path.trim()
  if (!trimmed) return null

  const match = DIARY_IMAGE_PATH_FULL_RE.exec(trimmed)
  if (!match) return null

  return {
    imageId: match[1].toLowerCase(),
    isThumbnail: Boolean(match[2]),
    normalizedPath: trimmed
  }
}

function collectImageCandidatesFromTextForMigration(
  text: string | null | undefined
): Map<string, MigrationImagePathCandidate> {
  const candidates = new Map<string, MigrationImagePathCandidate>()
  if (!text) return candidates

  DIARY_IMAGE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DIARY_IMAGE_PATH_RE.exec(text)) !== null) {
    const imageId = match[1].toLowerCase()
    const fullPath = match[0]
    const isThumbnail = Boolean(match[2])
    const current = candidates.get(imageId) ?? {}

    if (isThumbnail) {
      if (!current.previewPath) current.previewPath = fullPath
    } else if (!current.imagePath) {
      current.imagePath = fullPath
    }
    candidates.set(imageId, current)
  }
  DIARY_IMAGE_PATH_RE.lastIndex = 0

  return candidates
}

function collectArchiveImageCandidatesForMigration(
  mainImage: string | null,
  imagesJson: string | null
): Map<string, MigrationImagePathCandidate> {
  const candidates = new Map<string, MigrationImagePathCandidate>()
  const paths: string[] = []

  if (mainImage) {
    paths.push(mainImage)
  }

  if (imagesJson) {
    try {
      const parsed: unknown = JSON.parse(imagesJson)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') {
            paths.push(item)
          }
        }
      }
    } catch {
      // Ignore malformed archive image JSON during backfill.
    }
  }

  for (const path of paths) {
    const parsed = parseImagePathForMigration(path)
    if (!parsed) continue

    const current = candidates.get(parsed.imageId) ?? {}
    if (parsed.isThumbnail) {
      if (!current.previewPath) current.previewPath = parsed.normalizedPath
    } else if (!current.imagePath) {
      current.imagePath = parsed.normalizedPath
    }
    candidates.set(parsed.imageId, current)
  }

  return candidates
}

const migrations: Migration[] = [
  // Version 1: Initial schema
  (db) => {
    db.exec(`
      CREATE TABLE diary_entries
      (
        id         TEXT PRIMARY KEY,
        title      TEXT    NOT NULL DEFAULT '',
        content    TEXT    NOT NULL DEFAULT '',
        mood       TEXT    NOT NULL DEFAULT 'calm',
        weather    TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_entries_created_at ON diary_entries (created_at);
      CREATE INDEX idx_entries_mood ON diary_entries (mood);

      CREATE TABLE tags
      (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE diary_tags
      (
        diary_id TEXT    NOT NULL REFERENCES diary_entries (id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
        PRIMARY KEY (diary_id, tag_id)
      );

      CREATE INDEX idx_diary_tags_tag ON diary_tags (tag_id);

      CREATE TABLE attachments
      (
        id         TEXT PRIMARY KEY,
        diary_id   TEXT    NOT NULL REFERENCES diary_entries (id) ON DELETE CASCADE,
        filename   TEXT    NOT NULL,
        mime_type  TEXT    NOT NULL,
        file_path  TEXT    NOT NULL,
        size       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_attachments_diary ON attachments (diary_id);

      CREATE TABLE settings
      (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- FTS5 full-text search
      CREATE
      VIRTUAL TABLE diary_fts USING fts5(
        title,
        content,
        content=diary_entries,
        content_rowid=rowid,
        tokenize='unicode61'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER diary_fts_insert
        AFTER INSERT
        ON diary_entries
      BEGIN
        INSERT INTO diary_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      CREATE TRIGGER diary_fts_update
        AFTER UPDATE
        ON diary_entries
      BEGIN
        INSERT INTO diary_fts(diary_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
        INSERT INTO diary_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      CREATE TRIGGER diary_fts_delete
        AFTER DELETE
        ON diary_entries
      BEGIN
        INSERT INTO diary_fts(diary_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
      END;
    `)
  },

  // Version 2: Add plain_content column for reliable Chinese full-text search
  (db) => {
    // Add plain_content column — stores content stripped of HTML for accurate LIKE search
    db.exec(`ALTER TABLE diary_entries ADD COLUMN plain_content TEXT NOT NULL DEFAULT ''`)

    // Backfill plain_content for all existing entries
    const rows = db.prepare('SELECT id, content FROM diary_entries').all() as {
      id: string
      content: string
    }[]
    const update = db.prepare('UPDATE diary_entries SET plain_content = ? WHERE id = ?')
    for (const row of rows) {
      update.run(stripHtmlToPlain(row.content), row.id)
    }

    // Index for faster LIKE queries (helps with prefix matching)
    db.exec(`CREATE INDEX idx_entries_plain_content ON diary_entries(plain_content)`)
  },

  // Version 3: Remove unused FTS5 table and triggers (search uses LIKE on plain_content)
  (db) => {
    db.exec(`
      DROP TRIGGER IF EXISTS diary_fts_insert;
      DROP TRIGGER IF EXISTS diary_fts_update;
      DROP TRIGGER IF EXISTS diary_fts_delete;
      DROP TABLE IF EXISTS diary_fts;
    `)
  },

  // Version 4: Add archives table
  (db) => {
    db.exec(`
      CREATE TABLE archives (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        alias       TEXT,
        description TEXT,
        type        TEXT NOT NULL DEFAULT 'other',
        main_image  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX idx_archives_type ON archives(type);
      CREATE INDEX idx_archives_name ON archives(name);
    `)
  },

  // Version 5: Add images column to archives (JSON array for multiple images)
  (db) => {
    db.exec(`ALTER TABLE archives ADD COLUMN images TEXT DEFAULT '[]'`)
  },

  // Version 6: Rebuild searchable index with FTS5 for diary title/plain text
  (db) => {
    db.exec(`
      DROP TRIGGER IF EXISTS diary_search_fts_insert;
      DROP TRIGGER IF EXISTS diary_search_fts_update;
      DROP TRIGGER IF EXISTS diary_search_fts_delete;
      DROP TABLE IF EXISTS diary_search_fts;

      CREATE VIRTUAL TABLE diary_search_fts USING fts5(
        title,
        plain_content,
        content='diary_entries',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      INSERT INTO diary_search_fts(diary_search_fts) VALUES ('rebuild');

      CREATE TRIGGER diary_search_fts_insert
      AFTER INSERT ON diary_entries
      BEGIN
        INSERT INTO diary_search_fts(rowid, title, plain_content)
        VALUES (NEW.rowid, NEW.title, NEW.plain_content);
      END;

      CREATE TRIGGER diary_search_fts_update
      AFTER UPDATE OF title, plain_content ON diary_entries
      BEGIN
        INSERT INTO diary_search_fts(diary_search_fts, rowid, title, plain_content)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.plain_content);
        INSERT INTO diary_search_fts(rowid, title, plain_content)
        VALUES (NEW.rowid, NEW.title, NEW.plain_content);
      END;

      CREATE TRIGGER diary_search_fts_delete
      AFTER DELETE ON diary_entries
      BEGIN
        INSERT INTO diary_search_fts(diary_search_fts, rowid, title, plain_content)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.plain_content);
      END;
    `)
  },

  // Version 7: Track image reference counts for incremental cleanup
  (db) => {
    db.exec(`
      CREATE TABLE image_refs (
        image_id   TEXT PRIMARY KEY,
        ref_count  INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_image_refs_updated_at ON image_refs(updated_at);
    `)

    const imageRefCounts = new Map<string, number>()
    const addImageRefs = (ids: Iterable<string>): void => {
      for (const id of ids) {
        imageRefCounts.set(id, (imageRefCounts.get(id) ?? 0) + 1)
      }
    }

    const diaryRows = db.prepare('SELECT content FROM diary_entries').iterate() as Iterable<{
      content: string
    }>
    for (const row of diaryRows) {
      addImageRefs(extractImageIdsForMigration(row.content))
    }

    const archiveRows = db
      .prepare('SELECT main_image, images FROM archives')
      .iterate() as Iterable<{
      main_image: string | null
      images: string | null
    }>
    for (const row of archiveRows) {
      addImageRefs(extractImageIdsForMigration(row.main_image))

      if (!row.images) continue
      try {
        const images = JSON.parse(row.images) as unknown
        if (!Array.isArray(images)) continue

        for (const image of images) {
          if (typeof image === 'string') {
            addImageRefs(extractImageIdsForMigration(image))
          }
        }
      } catch {
        // Ignore malformed archive image JSON during backfill.
      }
    }

    const avatarRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('user.avatar') as
      | { value: string }
      | undefined
    if (avatarRow?.value) {
      addImageRefs(extractImageIdsForMigration(avatarRow.value))
    }

    const insertRef = db.prepare(
      'INSERT INTO image_refs (image_id, ref_count, updated_at) VALUES (?, ?, ?)'
    )
    const now = Date.now()

    for (const [imageId, refCount] of imageRefCounts) {
      insertRef.run(imageId, refCount, now)
    }
  },

  // Version 8: Add incremental mention/media indexes
  (db) => {
    db.exec(`
      CREATE TABLE person_mention_stats (
        archive_id   TEXT PRIMARY KEY REFERENCES archives(id) ON DELETE CASCADE,
        mention_count INTEGER NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
        updated_at   INTEGER NOT NULL
      );

      CREATE INDEX idx_person_mention_stats_count ON person_mention_stats(mention_count DESC);

      CREATE TABLE media_source_refs (
        image_id          TEXT NOT NULL,
        source_type       TEXT NOT NULL CHECK (source_type IN ('diary', 'archive')),
        source_id         TEXT NOT NULL,
        source_title      TEXT NOT NULL DEFAULT '',
        source_created_at INTEGER NOT NULL,
        source_updated_at INTEGER NOT NULL,
        image_path        TEXT NOT NULL,
        preview_path      TEXT NOT NULL,
        PRIMARY KEY (image_id, source_type, source_id)
      );

      CREATE INDEX idx_media_source_refs_updated ON media_source_refs(source_updated_at DESC, image_id);
      CREATE INDEX idx_media_source_refs_source ON media_source_refs(source_type, source_id);
      CREATE INDEX idx_media_source_refs_image ON media_source_refs(image_id);
    `)

    const insertMediaRef = db.prepare(
      `INSERT INTO media_source_refs (
         image_id,
         source_type,
         source_id,
         source_title,
         source_created_at,
         source_updated_at,
         image_path,
         preview_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const diaryRows = db
      .prepare(
        `SELECT id, title, content, created_at, updated_at
         FROM diary_entries
         WHERE content LIKE '%diary-image://%'`
      )
      .iterate() as Iterable<{
      id: string
      title: string
      content: string
      created_at: number
      updated_at: number
    }>
    for (const row of diaryRows) {
      const candidates = collectImageCandidatesFromTextForMigration(row.content)
      for (const [imageId, candidate] of candidates) {
        const fallbackPreviewPath = createFallbackPreviewPathForMigration(imageId)
        const imagePath = candidate.imagePath || candidate.previewPath || fallbackPreviewPath
        const previewPath = candidate.previewPath || fallbackPreviewPath
        insertMediaRef.run(
          imageId,
          'diary',
          row.id,
          row.title || '',
          row.created_at,
          row.updated_at,
          imagePath,
          previewPath
        )
      }
    }

    const archiveRows = db
      .prepare(
        `SELECT id, name, main_image, images, created_at, updated_at
         FROM archives
         WHERE main_image LIKE '%diary-image://%' OR images LIKE '%diary-image://%'`
      )
      .iterate() as Iterable<{
      id: string
      name: string
      main_image: string | null
      images: string | null
      created_at: number
      updated_at: number
    }>
    for (const row of archiveRows) {
      const candidates = collectArchiveImageCandidatesForMigration(row.main_image, row.images)
      for (const [imageId, candidate] of candidates) {
        const fallbackPreviewPath = createFallbackPreviewPathForMigration(imageId)
        const imagePath = candidate.imagePath || candidate.previewPath || fallbackPreviewPath
        const previewPath = candidate.previewPath || fallbackPreviewPath
        insertMediaRef.run(
          imageId,
          'archive',
          row.id,
          row.name || '',
          row.created_at,
          row.updated_at,
          imagePath,
          previewPath
        )
      }
    }
  }
]

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  if (currentVersion >= migrations.length) return

  const migrate = db.transaction(() => {
    for (let i = currentVersion; i < migrations.length; i++) {
      migrations[i](db)
      db.pragma(`user_version = ${i + 1}`)
    }
  })

  migrate()
}

import Database from 'better-sqlite3'

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

const migrations: Migration[] = [
  // Version 1: Initial schema
  (db) => {
    db.exec(`
      CREATE TABLE diary_entries (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL DEFAULT '',
        content       TEXT NOT NULL DEFAULT '',
        mood          TEXT NOT NULL DEFAULT 'calm',
        weather       TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE INDEX idx_entries_created_at ON diary_entries(created_at);
      CREATE INDEX idx_entries_mood ON diary_entries(mood);

      CREATE TABLE tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL UNIQUE
      );

      CREATE TABLE diary_tags (
        diary_id  TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
        tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (diary_id, tag_id)
      );

      CREATE INDEX idx_diary_tags_tag ON diary_tags(tag_id);

      CREATE TABLE attachments (
        id          TEXT PRIMARY KEY,
        diary_id    TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        size        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX idx_attachments_diary ON attachments(diary_id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- FTS5 full-text search
      CREATE VIRTUAL TABLE diary_fts USING fts5(
        title,
        content,
        content=diary_entries,
        content_rowid=rowid,
        tokenize='unicode61'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER diary_fts_insert AFTER INSERT ON diary_entries BEGIN
        INSERT INTO diary_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      CREATE TRIGGER diary_fts_update AFTER UPDATE ON diary_entries BEGIN
        INSERT INTO diary_fts(diary_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
        INSERT INTO diary_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      CREATE TRIGGER diary_fts_delete AFTER DELETE ON diary_entries BEGIN
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

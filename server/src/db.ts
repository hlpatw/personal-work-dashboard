import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Db = DatabaseSync;

/**
 * 打开（必要时创建）数据库并执行幂等建表。
 * 传入 ':memory:' 用于测试。
 */
export function initDb(path: string): Db {
  let db: Db;
  if (path === ':memory:') {
    db = new DatabaseSync(path);
  } else {
    const file = resolve(path);
    mkdirSync(dirname(file), { recursive: true });
    db = new DatabaseSync(file);
  }

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    -- 用户表：为多账号/上线预留。当前单机版只有 id=1 的内置本地用户；
    -- 未来增加注册/登录后，每个账号写入此表，业务表结构无需再改动。
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE CHECK(length(trim(username)) > 0),
      password_hash TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    INSERT OR IGNORE INTO users (id, username) VALUES (1, 'local');

    CREATE TABLE IF NOT EXISTS tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL CHECK(length(trim(title)) > 0),
      description  TEXT    NOT NULL DEFAULT '',
      category     TEXT    NOT NULL DEFAULT '工作'
                    CHECK(category IN ('工作','学习','生活','其他')),
      priority     TEXT    NOT NULL DEFAULT 'medium'
                    CHECK(priority IN ('urgent','high','medium','low')),
      status       TEXT    NOT NULL DEFAULT 'todo'
                    CHECK(status IN ('todo','in_progress','done')),
      due_date     TEXT,
      completed_at TEXT,
      estimated_minutes INTEGER,
      user_id      INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

    CREATE TABLE IF NOT EXISTS schedules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL CHECK(length(trim(title)) > 0),
      date       TEXT    NOT NULL,
      start_time TEXT,
      end_time   TEXT,
      location   TEXT    NOT NULL DEFAULT '',
      notes      TEXT    NOT NULL DEFAULT '',
      user_id    INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
  `);

  // 旧库迁移：为已存在的表补 user_id 列（存量数据归属本地用户）。
  // 必须在建 user 索引之前执行——旧表加列前，user_id 上无法建索引。
  migrateAddColumn(db, 'tasks', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  migrateAddColumn(db, 'schedules', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  // 预计完成时长（分钟），可空
  migrateAddColumn(db, 'tasks', 'estimated_minutes', 'INTEGER');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user     ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);
  `);

  return db;
}

/** 幂等加列迁移 */
function migrateAddColumn(db: Db, table: string, column: string, ddl: string): void {
  const cols = rows<{ name: string }>(db, `PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
  }
}

/** 查询多行并断言为指定类型 */
export function rows<T>(db: Db, sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/** 查询单行（无结果返回 undefined） */
export function row<T>(db: Db, sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/** 执行写语句，返回 { lastInsertRowid, changes } */
export function run(db: Db, sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}

/** 今天的本地日期，YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

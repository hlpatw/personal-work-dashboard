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

    -- 长期目标：跨数周~数月的大方向，任务通过 goal_id 归属
    CREATE TABLE IF NOT EXISTS goals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL CHECK(length(trim(title)) > 0),
      note        TEXT    NOT NULL DEFAULT '',
      target_date TEXT,
      status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','done','archived')),
      image_url   TEXT,
      user_id     INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_goals_user   ON goals(user_id);

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
      tags         TEXT    NOT NULL DEFAULT '[]',
      goal_id      INTEGER REFERENCES goals(id) ON DELETE SET NULL,
      user_id      INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

    -- 此刻灵感：灵感迸发的随手记录（时间流，不可编辑，记错就删）
    CREATE TABLE IF NOT EXISTS inspirations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT    NOT NULL CHECK(length(trim(content)) > 0),
      category   TEXT    NOT NULL DEFAULT '灵感'
                 CHECK(category IN ('灵感','工作','生活','心情')),
      image_url  TEXT,
      user_id    INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_inspirations_user ON inspirations(user_id);

    -- 子任务清单：挂在任务下的勾选项
    CREATE TABLE IF NOT EXISTS subtasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL CHECK(length(trim(title)) > 0),
      done       INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

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

  // 旧库迁移：为已存在的表补新列（存量数据归属本地用户）。
  // 必须在建 user 索引之前执行——旧表加列前，user_id 上无法建索引。
  migrateAddColumn(db, 'tasks', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  migrateAddColumn(db, 'schedules', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  // 预计完成时长（分钟），可空
  migrateAddColumn(db, 'tasks', 'estimated_minutes', 'INTEGER');
  // 标签（JSON 数组文本）与目标关联
  migrateAddColumn(db, 'tasks', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  migrateAddColumn(db, 'tasks', 'goal_id', 'INTEGER REFERENCES goals(id) ON DELETE SET NULL');
  // 贴图（Base64 Data URL，可空）
  migrateAddColumn(db, 'inspirations', 'image_url', 'TEXT');
  migrateAddColumn(db, 'goals', 'image_url', 'TEXT');

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

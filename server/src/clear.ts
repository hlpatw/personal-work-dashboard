import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, run } from './db.js';

/** 清空全部任务与日程（保留表结构），自增 id 从 1 重新开始 */
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const db = initDb(`${dataDir}/dashboard.db`);

run(db, 'DELETE FROM tasks');
run(db, 'DELETE FROM schedules');
run(db, "DELETE FROM sqlite_sequence WHERE name IN ('tasks','schedules')");

console.log('[clear] 已清空全部任务与日程');

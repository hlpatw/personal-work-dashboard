import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, run } from './db.js';

/** 清空全部业务数据（保留表结构与内置本地用户），自增 id 从 1 重新开始 */
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const db = initDb(`${dataDir}/dashboard.db`);

// 先解除/删除子表，再删除主表，满足外键约束。
run(db, 'DELETE FROM subtasks');
run(db, 'UPDATE tasks SET goal_id = NULL');
run(db, 'DELETE FROM tasks');
run(db, 'DELETE FROM schedules');
run(db, 'DELETE FROM goals');
run(db, 'DELETE FROM inspirations');
run(db, "DELETE FROM sqlite_sequence WHERE name IN ('tasks','schedules','subtasks','goals','inspirations')");

console.log('[clear] 已清空全部任务、日程、目标、子任务与灵感');

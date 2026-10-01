import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, run } from './db.js';

/** 生成示例数据：约 30 条跨两周的任务 + 一周日程 */
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const db = initDb(`${dataDir}/dashboard.db`);

/** 相对今天偏移 N 天的本地日期，YYYY-MM-DD */
function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function ts(offsetDays: number, hm = '10:00'): string {
  return `${dateStr(offsetDays)} ${hm}:00`;
}

// 清空旧数据
run(db, 'DELETE FROM tasks');
run(db, "DELETE FROM sqlite_sequence WHERE name IN ('tasks','schedules')");

// ---- 任务：过去两周（部分已完成，completed_at 分散供图表使用）----
const past: Array<[string, string, string, number, number | null]> = [
  // [标题, 分类, 优先级, 截止日偏移, 完成日偏移(null=未完成)]
  ['整理季度 OKR', '工作', 'high', -12, -12],
  ['修复首页加载缓慢问题', '工作', 'urgent', -11, -11],
  ['阅读《深度工作》前三章', '学习', 'medium', -10, -9],
  ['预约体检', '生活', 'medium', -9, -9],
  ['编写单元测试规范文档', '工作', 'low', -8, -7],
  ['背 50 个英语单词', '学习', 'low', -8, -8],
  ['准备周会汇报材料', '工作', 'high', -7, -7],
  ['缴费水电费', '生活', 'medium', -7, -6],
  ['重构用户模块错误处理', '工作', 'high', -6, -5],
  ['完成线上课程第 2 节', '学习', 'medium', -5, -5],
  ['整理书桌', '生活', 'low', -5, -4],
  ['修复移动端样式错位', '工作', 'urgent', -4, -4],
  ['跟客户确认需求变更', '工作', 'high', -3, -3],
  ['写月度复盘笔记', '其他', 'low', -3, -2],
  ['背 60 个英语单词', '学习', 'low', -2, -2],
  ['修复导出报表乱码', '工作', 'high', -2, -1],
  ['给爸妈打电话', '生活', 'medium', -1, -1],
];

for (const [title, category, priority, due, doneDay] of past) {
  const isDone = doneDay !== null;
  run(
    db,
    `INSERT INTO tasks (title, category, priority, status, due_date, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    title,
    category,
    priority,
    isDone ? 'done' : 'todo',
    dateStr(due),
    isDone ? ts(doneDay, `${10 + (due + 12) % 9}:15`) : null,
    ts(due - 3, '09:00'),
    ts(isDone ? doneDay : due, isDone ? '20:30' : '09:00')
  );
}

// ---- 逾期未完成 ----
const overdue: Array<[string, string, string, number]> = [
  ['归还图书馆书籍', '生活', 'low', -2],
  ['更新依赖包版本', '工作', 'medium', -1],
];
for (const [title, category, priority, due] of overdue) {
  run(
    db,
    `INSERT INTO tasks (title, category, priority, status, due_date, created_at, updated_at)
     VALUES (?, ?, ?, 'todo', ?, ?, ?)`,
    title, category, priority, dateStr(due), ts(due - 2, '09:00'), ts(due, '09:00')
  );
}

// ---- 本周与未来 ----
const week: Array<[string, string, string, number, string | null]> = [
  // [标题, 分类, 优先级, 截止日偏移, 状态]
  ['今日：发送项目周报', '工作', 'high', 0, 'in_progress'],
  ['今日：回复客户邮件', '工作', 'medium', 0, null],
  ['今日：晚上健身 30 分钟', '生活', 'low', 0, null],
  ['明日：参加技术评审会预研', '工作', 'urgent', 1, 'todo'],
  ['明日：背 40 个单词', '学习', 'low', 1, null],
  ['写新功能技术方案', '工作', 'high', 2, 'todo'],
  ['完成线上课程第 3 节', '学习', 'medium', 3, 'todo'],
  ['周末：大扫除', '生活', 'low', 5, null],
  ['下周：制定 11 月计划', '其他', 'medium', 8, 'todo'],
  ['下月：读完《原则》', '学习', 'low', 20, 'todo'],
];
for (const [title, category, priority, due, status] of week) {
  run(
    db,
    `INSERT INTO tasks (title, category, priority, status, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    title, category, priority, status ?? 'todo', dateStr(due), ts(Math.min(due - 1, 0), '09:00'), ts(0, '09:00')
  );
}

// ---- 日程：今天与未来几天 ----
run(db, "DELETE FROM schedules");
const schedules: Array<[string, number, string | null, string | null, string]> = [
  ['团队每日站会', 0, '09:30', '09:45', '线上'],
  ['新版本方案评审', 0, '14:00', '15:30', '会议室 A'],
  ['和 mentor 一对一', 0, '17:00', '17:30', ''],
  ['项目上线窗口', 1, '22:00', '23:00', ''],
  ['牙医复诊', 2, '10:30', '11:30', '口腔医院'],
  ['部门季度总结会', 3, null, null, '多功能厅'],
  ['朋友聚餐', 5, '18:30', null, '市中心餐厅'],
];
for (const [title, day, start, end, location] of schedules) {
  run(
    db,
    `INSERT INTO schedules (title, date, start_time, end_time, location, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
    title, dateStr(day), start, end, location, ts(-1, '09:00'), ts(-1, '09:00')
  );
}

const total = (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
const totalSchedules = (db.prepare('SELECT COUNT(*) AS c FROM schedules').get() as { c: number }).c;
console.log(`[seed] 已写入 ${total} 条任务、${totalSchedules} 条日程`);

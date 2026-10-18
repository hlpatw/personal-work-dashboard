import { fetchTasks } from '../api/tasks';
import { fetchTodaySchedules } from '../api/schedules';
import { fetchSummary } from '../api/stats';
import { PRIORITY_LABELS, type Task } from '../api/types';
import { formatCN, todayStr } from './date';

/** 「帮我安排今天」快捷指令的预置文案（填入输入框，不直接发送） */
export const QUICK_PROMPT_TODAY = '帮我安排一下今天的任务和日程吧，看看先做什么、后做什么';

/** 列表条数上限与全文硬上限（防撞单条消息 8000 字符的接口校验） */
const LIST_CAP = 8;
const TOTAL_CAP = 2000;

function capList(items: string[]): string {
  if (items.length === 0) return '无';
  const shown = items.slice(0, LIST_CAP).join('、');
  return items.length > LIST_CAP ? `${shown}（等 ${items.length} 项）` : shown;
}

function capTotal(s: string): string {
  return s.length > TOTAL_CAP ? s.slice(0, TOTAL_CAP) + '…（已截断）' : s;
}

/**
 * 今日工作台快照：发送时现取（侧栏可能挂一整天，缓存必陈旧；本地 SQLite 毫秒级）。
 * 拼接进单条 system 消息（兼容性最好，不占 40 条对话名额）。
 * 任何数据获取失败都静默返回空串——聊天不被本地数据故障阻塞。
 */
export async function buildTodaySnapshot(): Promise<string> {
  try {
    const [summary, tasks, schedules] = await Promise.all([
      fetchSummary(),
      fetchTasks({}),
      fetchTodaySchedules(),
    ]);
    const today = todayStr();
    // 过滤口径与概览页一致（DashboardPage）
    const notDone = (t: Task) => t.status !== 'done';
    const overdue = tasks.filter((t) => notDone(t) && t.due_date !== null && t.due_date < today);
    const todo = tasks.filter(
      (t) => notDone(t) && (t.due_date === today || (t.due_date === null && t.created_at.startsWith(today)))
    );
    const inProgress = tasks.filter((t) => t.status === 'in_progress');
    const doneToday = tasks.filter((t) => t.status === 'done' && t.completed_at?.startsWith(today));

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const lines = [
      `【今日工作台快照 · ${today} ${hhmm}】`,
      `今日待办 ${todo.length} 项：${capList(todo.map((t) => `${t.title}（${PRIORITY_LABELS[t.priority]}）`))}`,
      `进行中 ${inProgress.length} 项：${capList(inProgress.map((t) => t.title))}`,
      `今日已完成 ${doneToday.length} 项：${capList(doneToday.map((t) => t.title))}`,
      `逾期 ${overdue.length} 项：${capList(overdue.map((t) => `${t.title}（截止${formatCN(t.due_date!, 'M月d日')}）`))}`,
      `今日日程 ${schedules.length} 场：${capList(schedules.map((s) => `${s.start_time ?? '全天'} ${s.title}`))}`,
      `完成率 ${summary.today.completion_rate}%。基于以上信息回答时可以自然引用，但别逐条复述。`,
    ];
    return capTotal(lines.join('\n'));
  } catch {
    return '';
  }
}

/** 周报卡传给「让柯基点评」的数据（卡片侧计算，这里只负责拼文案） */
export interface WeeklyDigestData {
  rangeLabel: string;
  doneCount: number;
  lastDoneCount: number;
  busiestDay: string | null;
  busiestCount: number;
  categoryChanges: { category: string; delta: number }[];
  overdueTitles: string[];
}

/** 周报点评消息：数据内联在 user 消息里（自包含、进入对话历史可追问） */
export function buildWeeklyDigest(d: WeeklyDigestData): string {
  const delta = d.doneCount - d.lastDoneCount;
  const lines = [
    `【本周周报 · ${d.rangeLabel}】`,
    `本周完成 ${d.doneCount} 项（上周 ${d.lastDoneCount} 项，${delta >= 0 ? `+${delta}` : delta}）`,
  ];
  if (d.busiestDay) lines.push(`最活跃的一天：${d.busiestDay}（${d.busiestCount} 项）`);
  if (d.categoryChanges.length > 0) {
    lines.push(`分类变化：${d.categoryChanges.map((c) => `${c.category} ${c.delta >= 0 ? '+' : ''}${c.delta}`).join('、')}`);
  }
  lines.push(d.overdueTitles.length > 0 ? `逾期待处理 ${d.overdueTitles.length} 项：${capList(d.overdueTitles)}` : '无逾期任务');
  lines.push('这是自动生成的数据。请点评我这一周的表现：先真诚地肯定亮点，再给一条可执行的小建议，温暖简洁。');
  return capTotal(lines.join('\n'));
}

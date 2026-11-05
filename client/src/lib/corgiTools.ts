/**
 * 柯基工具调用（function calling）：工具定义 + 前端执行器。
 * 后端只透传 tools 与 tool_calls（见 server/src/routes/ai.ts），执行全部在
 * 前端完成——写操作先经确认卡（用户勾选/微调标题）再走现有 REST API。
 */
import { addDays, format, subDays } from 'date-fns';
import { createTask, deleteTask, fetchSubtasks, fetchTasks, updateTask, updateTaskStatus, type TaskFilters } from '../api/tasks';
import { deleteGoal, fetchGoals, updateGoal } from '../api/goals';
import { createSchedule, deleteSchedule, fetchSchedulesByRange } from '../api/schedules';
import { createInspiration, deleteInspiration, fetchInspirations } from '../api/inspirations';
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  INSPIRATION_CATEGORIES,
  CATEGORY_META,
  PRIORITY_LABELS,
  GOAL_STATUS_LABELS,
  type TaskCategory,
  type TaskPriority,
  type TaskInput,
  type Task,
  type Goal,
  type GoalInput,
  type GoalStatus,
  type Schedule,
  type Inspiration,
} from '../api/types';
import type { AiToolCall, AiToolDef } from '../api/ai';

export type ToolName =
  | 'create_tasks'
  | 'list_tasks'
  | 'complete_tasks'
  | 'create_schedules'
  | 'create_inspirations'
  | 'update_tasks'
  | 'update_goals'
  | 'delete_tasks'
  | 'delete_schedules'
  | 'delete_inspirations'
  | 'delete_goals';

const GOAL_STATUSES = ['active', 'done', 'archived'] as const;

/** 一次工具调用的持久化记录（args 已解析；解析失败置 parseError） */
export interface ToolCallRecord {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  parseError?: string;
}

/** 单条结果：ok=成功 / fail=失败 / skip=用户未勾选或跳过 */
export interface ToolItemOutcome {
  status: 'ok' | 'fail' | 'skip';
  label: string;
  detail?: string;
  id?: number;
}

/** 一次工具调用的执行结果（tool 消息的数据源） */
export interface ToolExecOutcome {
  tool: ToolName;
  items: ToolItemOutcome[];
  /** 用户整单跳过 */
  skipped?: boolean;
  /** 整体失败（如网络异常） */
  error?: string;
}

/** 上游返回的 tool_calls（wire 层）解析为持久化记录 */
export function parseToolCalls(raw: AiToolCall[]): ToolCallRecord[] {
  return raw.map((tc) => {
    const name = (tc.function?.name ?? '') as ToolName;
    let args: Record<string, unknown> = {};
    let parseError: string | undefined;
    try {
      const parsed = JSON.parse(tc.function?.arguments || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      } else {
        parseError = '参数不是 JSON 对象';
      }
    } catch {
      parseError = '参数 JSON 解析失败';
    }
    return { id: tc.id, name, args, parseError };
  });
}

/** 执行结果序列化为 tool 消息 content（给模型看），超长截断 */
export function serializeOutcome(oc: ToolExecOutcome): string {
  const payload = {
    tool: oc.tool,
    ...(oc.skipped ? { skipped: true } : {}),
    ...(oc.error ? { error: oc.error } : {}),
    items: oc.items.map((it) => ({
      status: it.status,
      label: it.label.slice(0, 120),
      ...(it.id != null ? { id: it.id } : {}),
      ...(it.detail ? { detail: it.detail.slice(0, 200) } : {}),
    })),
  };
  let text = JSON.stringify(payload);
  if (text.length > 4000) text = `${text.slice(0, 4000)}…（已截断）`;
  return text;
}

/* ===================== 校验与清洗 ===================== */

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** 枚举命中返回值、否则 undefined（区别于带 fallback 的 oneOf，用于"只改出现的字段"合并链） */
const oneOfOrNull = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

const validDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const validTime = (v: unknown): string | null => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface ItemArgs {
  [k: string]: unknown;
}

/** 按勾选与标题微调过滤批量条目；selected 为下标集合，undefined = 全选 */
function pickItems<T extends ItemArgs>(
  list: unknown,
  sel: { selected?: number[]; titleOverrides?: Record<number, string> },
): { picked: { item: T; index: number }[]; skipped: T[] } {
  const all = (Array.isArray(list) ? list : []) as T[];
  const selected = sel.selected;
  const picked: { item: T; index: number }[] = [];
  const skipped: T[] = [];
  all.forEach((item, index) => {
    if (selected == null || selected.includes(index)) picked.push({ item, index });
    else skipped.push(item);
  });
  return { picked, skipped };
}

/** 用户改过的标题（仅对选中项生效） */
function titleOf(sel: { titleOverrides?: Record<number, string> }, index: number, fallback: string): string {
  return str(sel.titleOverrides?.[index], 200) || fallback;
}

/**
 * 宽容解析批量条目：复数/单数键都认，裸字符串视为 stringField，单对象包成数组
 * （救弱模型的常见写法：{"task": "名字"} / "tasks": ["名字"]）
 */
function toolItems(args: Record<string, unknown>, keys: string[], stringField = 'title'): ItemArgs[] {
  for (const k of keys) {
    const v = args[k];
    if (Array.isArray(v)) {
      return v.flatMap((x) =>
        typeof x === 'string'
          ? x.trim()
            ? [{ [stringField]: x.trim() } as ItemArgs]
            : []
          : x && typeof x === 'object'
            ? [x as ItemArgs]
            : [],
      );
    }
    if (typeof v === 'string' && v.trim()) return [{ [stringField]: v.trim() } as ItemArgs];
    if (v && typeof v === 'object') return [v as ItemArgs];
  }
  return [];
}

/* ===================== 执行器 ===================== */

export interface ExecSelection {
  /** 勾选的条目下标（undefined = 全部执行） */
  selected?: number[];
  /** 用户微调后的标题：下标 → 新标题 */
  titleOverrides?: Record<number, string>;
  /** 确认卡上微调的属性：下标 → 字段名（due_date/priority/target_date…）→ 新值 */
  fieldOverrides?: Record<number, Record<string, string>>;
}

const skipOutcome = (label: string): ToolItemOutcome => ({ status: 'skip', label });

/** 执行一次工具调用（写类由确认卡带着勾选结果调；只读直接全量执行） */
export async function executeToolCall(rec: ToolCallRecord, sel: ExecSelection = {}): Promise<ToolExecOutcome> {
  try {
    switch (rec.name) {
      case 'create_tasks':
        return await execCreateTasks(rec.args, sel);
      case 'list_tasks':
        return await execListTasks(rec.args);
      case 'complete_tasks':
        return await execCompleteTasks(rec.args, sel);
      case 'create_schedules':
        return await execCreateSchedules(rec.args, sel);
      case 'create_inspirations':
        return await execCreateInspirations(rec.args, sel);
      case 'update_tasks':
        return await execUpdateTasks(rec.args, sel);
      case 'update_goals':
        return await execUpdateGoals(rec.args, sel);
      case 'delete_tasks':
        return await execDeleteTasks(rec.args, sel);
      case 'delete_schedules':
        return await execDeleteSchedules(rec.args, sel);
      case 'delete_inspirations':
        return await execDeleteInspirations(rec.args, sel);
      case 'delete_goals':
        return await execDeleteGoals(rec.args, sel);
      default:
        return { tool: rec.name, items: [], error: `未知工具：${rec.name}` };
    }
  } catch (e) {
    return { tool: rec.name, items: [], error: (e as Error).message };
  }
}

async function execCreateTasks(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['tasks', 'task']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title, 120) || '未命名任务'));
  for (const { item, index } of picked) {
    const title = titleOf(sel, index, str(item.title));
    if (!title) {
      items.push({ status: 'fail', label: '（无标题）', detail: '标题为空' });
      continue;
    }
    const input: TaskInput = {
      title,
      description: str(item.description, 2000),
      category: oneOf(TASK_CATEGORIES, item.category, '工作'),
      priority: oneOf(TASK_PRIORITIES, item.priority, 'medium'),
      status: 'todo',
      due_date: validDate(item.due_date) ?? todayStr(),
      estimated_minutes: typeof item.estimated_minutes === 'number' && item.estimated_minutes >= 0 ? item.estimated_minutes : null,
      tags: (Array.isArray(item.tags) ? item.tags : []).filter((t): t is string => typeof t === 'string').slice(0, 8),
      goal_id: null,
      image_url: null,
      subtasks: [],
    };
    try {
      const created = await createTask(input);
      items.push({ status: 'ok', label: created.title, id: created.id });
    } catch (e) {
      items.push({ status: 'fail', label: title, detail: (e as Error).message });
    }
  }
  return { tool: 'create_tasks', items };
}

async function execListTasks(args: Record<string, unknown>): Promise<ToolExecOutcome> {
  const filters: TaskFilters = {};
  if (typeof args.status === 'string' && ['todo', 'in_progress', 'done'].includes(args.status)) {
    filters.status = args.status as TaskFilters['status'];
  }
  if (typeof args.category === 'string') filters.category = args.category;
  if (typeof args.q === 'string' && args.q.trim()) filters.q = args.q.trim();
  if (args.overdue === true) filters.overdue = true;
  let tasks = await fetchTasks(filters);
  if (args.today === true) {
    const today = todayStr();
    tasks = tasks.filter((t) => t.due_date === today);
  }
  // 给模型：最多 15 条摘要
  const items: ToolItemOutcome[] = tasks.slice(0, 15).map((t) => ({
    status: 'ok' as const,
    label: `#${t.id} ${t.title}`,
    detail: `${oneOf(TASK_CATEGORIES, t.category, '工作')}｜${t.status === 'done' ? '已完成' : t.status === 'in_progress' ? '进行中' : '待办'}${t.due_date ? `｜截止 ${t.due_date}` : ''}`,
    id: t.id,
  }));
  if (tasks.length > 15) items.push({ status: 'ok', label: `…共 ${tasks.length} 条，仅列前 15 条` });
  return { tool: 'list_tasks', items };
}

async function execCompleteTasks(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['tasks', 'task']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `任务 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    const editedTitle = titleOf(sel, index, str(item.title, 200));
    const label = editedTitle || `任务 #${item.id ?? '?'}`;
    try {
      const target = await resolveTask({ id: item.id, title: editedTitle });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应任务（按 id 或标题精确匹配）' });
        continue;
      }
      await updateTaskStatus(target.id, 'done');
      items.push({ status: 'ok', label: target.title, id: target.id });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'complete_tasks', items };
}

/** id 优先；仅标题时精确匹配（多个同名 → 报歧义，绝不猜）。update/delete 场景含已完成条目 */
async function resolveTask(item: ItemArgs, opts: { includeDone?: boolean } = {}): Promise<Task | null> {
  const all = await fetchTasks({});
  if (typeof item.id === 'number') {
    return all.find((t) => t.id === item.id) ?? null;
  }
  const title = str(item.title, 200);
  if (!title) return null;
  const hits = all.filter((t) => t.title === title && (opts.includeDone || t.status !== 'done'));
  return hits.length === 1 ? hits[0] : null;
}

/** 目标匹配：id 优先，标题全等唯一（fetchGoals 不带 status = 全部状态） */
async function resolveGoal(item: ItemArgs): Promise<Goal | null> {
  const all = await fetchGoals();
  if (typeof item.id === 'number') {
    return all.find((g) => g.id === item.id) ?? null;
  }
  const title = str(item.title, 200);
  if (!title) return null;
  const hits = all.filter((g) => g.title === title);
  return hits.length === 1 ? hits[0] : null;
}

/** 日程匹配：无全量接口，按日期窗口拉取（有 date 单日查，缺省近 30 天～未来 180 天），title 全等 + date 全等唯一 */
async function resolveSchedule(item: ItemArgs): Promise<Schedule | null> {
  const date = validDate(item.date);
  const from = date ?? format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const to = date ?? format(addDays(new Date(), 180), 'yyyy-MM-dd');
  const list = await fetchSchedulesByRange(from, to);
  if (typeof item.id === 'number') {
    return list.find((s) => s.id === item.id) ?? null;
  }
  const title = str(item.title, 200);
  if (!title) return null;
  const hits = list.filter((s) => s.title === title && (!date || s.date === date));
  return hits.length === 1 ? hits[0] : null;
}

/** 灵感匹配：id 优先 → 内容全文全等唯一 → 唯一子串（模型难以逐字复述，留子串入口；歧义即失败） */
async function resolveInspiration(item: ItemArgs): Promise<Inspiration | null> {
  const all = await fetchInspirations();
  if (typeof item.id === 'number') {
    return all.find((i) => i.id === item.id) ?? null;
  }
  const content = str(item.content, 500);
  if (!content) return null;
  const exact = all.filter((i) => i.content === content);
  if (exact.length === 1) return exact[0];
  const partial = all.filter((i) => i.content.includes(content));
  return partial.length === 1 ? partial[0] : null;
}

/**
 * 可空日期合并链：卡上微调 > 模型参数（null = 清除）> 现有值。
 * 用 `'key' in item` 判断模型是否传了该字段（null 与未传语义不同）。
 */
function mergeNullableDate(
  ov: unknown,
  item: ItemArgs,
  key: string,
  current: string | null,
): string | null {
  const fromCard = validDate(ov);
  if (fromCard) return fromCard;
  if (key in item) {
    if (item[key] == null || item[key] === '') return null;
    return validDate(item[key]) ?? current;
  }
  return current;
}

async function execCreateSchedules(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['schedules', 'schedule']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title, 120) || '未命名日程'));
  for (const { item, index } of picked) {
    const title = titleOf(sel, index, str(item.title));
    const date = validDate(item.date);
    if (!title || !date) {
      items.push({ status: 'fail', label: title || '（无标题）', detail: date ? '标题为空' : '日期格式应为 YYYY-MM-DD' });
      continue;
    }
    try {
      const created = await createSchedule({
        title,
        date,
        start_time: validTime(item.start_time),
        end_time: validTime(item.end_time),
        location: str(item.location, 200),
        notes: str(item.notes, 2000),
      });
      items.push({ status: 'ok', label: created.title, id: created.id });
    } catch (e) {
      items.push({ status: 'fail', label: title, detail: (e as Error).message });
    }
  }
  return { tool: 'create_schedules', items };
}

async function execCreateInspirations(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['inspirations', 'inspiration'], 'content'), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.content, 60) || '灵感'));
  for (const { item } of picked) {
    const content = str(item.content, 500);
    if (!content) {
      items.push({ status: 'fail', label: '（空）', detail: '内容为空' });
      continue;
    }
    try {
      const created = await createInspiration({
        content,
        category: oneOf(INSPIRATION_CATEGORIES, item.category, '灵感'),
        image_url: null,
      });
      items.push({ status: 'ok', label: created.content.slice(0, 60), id: created.id });
    } catch (e) {
      items.push({ status: 'fail', label: content.slice(0, 60), detail: (e as Error).message });
    }
  }
  return { tool: 'create_inspirations', items };
}

async function execUpdateTasks(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['tasks', 'task']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `任务 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    // 语义约定：update_* 卡上改标题输入框 = 改 new_title（改名），不是修正匹配词
    const matchTitle = str(item.title, 200);
    const renameTo = titleOf(sel, index, str(item.new_title, 200));
    const label = renameTo || matchTitle || `任务 #${item.id ?? '?'}`;
    try {
      const target = await resolveTask({ id: item.id, title: matchTitle }, { includeDone: true });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应任务（按 id 或标题精确匹配）' });
        continue;
      }
      // PUT 是全量替换：必须先取回子任务；取失败让整条 fail，绝不静默清空
      const subtasks = await fetchSubtasks(target.id);
      const ov = sel.fieldOverrides?.[index] ?? {};
      const changes: string[] = [];
      const input: TaskInput = {
        title: target.title,
        description: target.description,
        category: target.category,
        priority: target.priority,
        status: target.status,
        due_date: target.due_date,
        estimated_minutes: target.estimated_minutes,
        tags: target.tags,
        goal_id: target.goal_id, // 改归属不在本期范围，原样回填
        image_url: target.image_url,
        subtasks: subtasks.map((s) => ({ title: s.title, done: s.done })),
      };
      if (renameTo && renameTo !== target.title) {
        input.title = renameTo;
        changes.push('改名');
      }
      const pri = oneOfOrNull(TASK_PRIORITIES, ov.priority) ?? oneOfOrNull(TASK_PRIORITIES, item.priority);
      if (pri && pri !== target.priority) {
        input.priority = pri;
        changes.push(`优先级 ${PRIORITY_LABELS[pri]}`);
      }
      const cat = oneOfOrNull(TASK_CATEGORIES, item.category);
      if (cat && cat !== target.category) {
        input.category = cat;
        changes.push(`分类 ${cat}`);
      }
      const status = oneOfOrNull(TASK_STATUSES, item.status);
      if (status && status !== target.status) {
        input.status = status;
        changes.push(status === 'done' ? '已完成' : status === 'in_progress' ? '进行中' : '待办');
      }
      const due = mergeNullableDate(ov.due_date, item, 'due_date', target.due_date);
      if (due !== target.due_date) {
        input.due_date = due;
        changes.push(due ? `截止 ${due}` : '清空截止');
      }
      if ('estimated_minutes' in item) {
        const m = item.estimated_minutes;
        const v =
          typeof m === 'number' && m >= 0 && m <= 100000
            ? Math.round(m)
            : m == null || m === ''
              ? null
              : target.estimated_minutes;
        if (v !== target.estimated_minutes) {
          input.estimated_minutes = v;
          changes.push(v != null ? `时长 ${v} 分钟` : '清空时长');
        }
      }
      if (Array.isArray(item.tags)) {
        const tags = (item.tags as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().slice(0, 20))
          .filter(Boolean)
          .slice(0, 8);
        input.tags = tags;
        if (tags.join('\u0000') !== target.tags.join('\u0000')) changes.push('标签已更新');
      }
      if (typeof item.description === 'string' && str(item.description, 2000) !== target.description) {
        input.description = str(item.description, 2000);
        changes.push('描述已更新');
      }
      const updated = await updateTask(target.id, input);
      items.push({ status: 'ok', label: updated.title, id: updated.id, detail: changes.join(' · ') || '无字段变更' });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'update_tasks', items };
}

async function execUpdateGoals(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['goals', 'goal']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `目标 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    const matchTitle = str(item.title, 200);
    const renameTo = titleOf(sel, index, str(item.new_title, 200));
    const label = renameTo || matchTitle || `目标 #${item.id ?? '?'}`;
    try {
      const target = await resolveGoal({ id: item.id, title: matchTitle });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应目标（按 id 或标题精确匹配）' });
        continue;
      }
      const ov = sel.fieldOverrides?.[index] ?? {};
      const changes: string[] = [];
      const input: GoalInput = {
        title: target.title,
        note: target.note,
        category: target.category,
        target_date: target.target_date,
        status: target.status,
        image_url: target.image_url, // zod 全字段默认值：漏回填会清贴图
      };
      if (renameTo && renameTo !== target.title) {
        input.title = renameTo;
        changes.push('改名');
      }
      const cat = oneOfOrNull(TASK_CATEGORIES, item.category);
      if (cat && cat !== target.category) {
        input.category = cat;
        changes.push(`分类 ${cat}`);
      }
      const status = oneOfOrNull(GOAL_STATUSES, item.status);
      if (status && status !== target.status) {
        input.status = status;
        changes.push(GOAL_STATUS_LABELS[status as GoalStatus]);
      }
      const date = mergeNullableDate(ov.target_date, item, 'target_date', target.target_date);
      if (date !== target.target_date) {
        input.target_date = date;
        changes.push(date ? `目标日期 ${date}` : '清空目标日期');
      }
      if (typeof item.note === 'string' && str(item.note, 2000) !== target.note) {
        input.note = str(item.note, 2000);
        changes.push('备注已更新');
      }
      const updated = await updateGoal(target.id, input);
      items.push({ status: 'ok', label: updated.title, id: updated.id, detail: changes.join(' · ') || '无字段变更' });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'update_goals', items };
}

async function execDeleteTasks(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['tasks', 'task']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `任务 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    // 删除卡上改标题 = 修正匹配词（同 complete_tasks）
    const editedTitle = titleOf(sel, index, str(item.title, 200));
    const label = editedTitle || `任务 #${item.id ?? '?'}`;
    try {
      const target = await resolveTask({ id: item.id, title: editedTitle }, { includeDone: true });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应任务（按 id 或标题精确匹配）' });
        continue;
      }
      await deleteTask(target.id);
      items.push({ status: 'ok', label: target.title, id: target.id });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'delete_tasks', items };
}

async function execDeleteSchedules(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['schedules', 'schedule']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `日程 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    const editedTitle = titleOf(sel, index, str(item.title, 200));
    const label = editedTitle || `日程 #${item.id ?? '?'}`;
    try {
      const target = await resolveSchedule({ id: item.id, title: editedTitle, date: item.date });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应日程（按 id 或 标题+日期 精确匹配）' });
        continue;
      }
      await deleteSchedule(target.id);
      items.push({
        status: 'ok',
        label: target.title,
        id: target.id,
        detail: `${target.date}${target.start_time ? ` ${target.start_time}` : ''}`,
      });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'delete_schedules', items };
}

async function execDeleteInspirations(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['inspirations', 'inspiration'], 'content'), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.content ?? s.id, 60) || '灵感'));
  for (const { item, index } of picked) {
    const editedContent = titleOf(sel, index, str(item.content, 500));
    const label = editedContent.slice(0, 60) || `灵感 #${item.id ?? '?'}`;
    try {
      const target = await resolveInspiration({ id: item.id, content: editedContent });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应灵感（按 id 或内容精确/唯一匹配）' });
        continue;
      }
      await deleteInspiration(target.id);
      items.push({ status: 'ok', label: target.content.slice(0, 60), id: target.id });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'delete_inspirations', items };
}

async function execDeleteGoals(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(toolItems(args, ['goals', 'goal']), sel);
  const items: ToolItemOutcome[] = [];
  for (const s of skipped) items.push(skipOutcome(str(s.title ?? s.id, 120) || `目标 #${s.id ?? '?'}`));
  for (const { item, index } of picked) {
    const editedTitle = titleOf(sel, index, str(item.title, 200));
    const label = editedTitle || `目标 #${item.id ?? '?'}`;
    try {
      const target = await resolveGoal({ id: item.id, title: editedTitle });
      if (!target) {
        items.push({ status: 'fail', label, detail: '未找到对应目标（按 id 或标题精确匹配）' });
        continue;
      }
      await deleteGoal(target.id);
      items.push({
        status: 'ok',
        label: target.title,
        id: target.id,
        ...(target.task_total > 0 ? { detail: `其下 ${target.task_total} 个任务已解除关联` } : {}),
      });
    } catch (e) {
      items.push({ status: 'fail', label, detail: (e as Error).message });
    }
  }
  return { tool: 'delete_goals', items };
}

/* ===================== 确认卡展示辅助 ===================== */

/** 待确认条目上的属性微调编辑器（由 describeCall 声明，ToolCard 数据驱动渲染） */
export interface ToolItemEdit {
  key: string;
  kind: 'date' | 'select';
  /** date: YYYY-MM-DD；select: 枚举值 */
  value: string;
  /** select 用 */
  options?: { value: string; label: string }[];
}

export interface ToolItemView {
  title: string;
  badges: { text: string; cls: string }[];
  /** 仅待确认态渲染；只给"模型正在改的字段"生成 */
  edits?: ToolItemEdit[];
}

/** 展开一次调用为确认卡的头部文案 + 条目（parseError / 空列表返回 null；danger=删除类红色警示） */
export function describeCall(rec: ToolCallRecord): { head: string; items: ToolItemView[]; danger?: boolean } | null {
  if (rec.parseError) return null;
  const catBadge = (c: unknown) => {
    const cat = oneOf(TASK_CATEGORIES, c, '工作') as TaskCategory;
    return { text: cat, cls: CATEGORY_META[cat].chip };
  };
  const priBadge = (p: unknown) => {
    const pri = oneOf(TASK_PRIORITIES, p, 'medium') as TaskPriority;
    return { text: PRIORITY_LABELS[pri], cls: 'text-zinc-500 dark:text-zinc-400' };
  };
  switch (rec.name) {
    case 'create_tasks': {
      const list = toolItems(rec.args, ['tasks', 'task']);
      if (!list.length) return null;
      return {
        head: `创建 ${list.length} 个任务`,
        items: list.map((t) => ({
          title: str(t.title, 120),
          badges: [catBadge(t.category), priBadge(t.priority), ...(validDate(t.due_date) ? [{ text: validDate(t.due_date)!, cls: 'text-zinc-500 dark:text-zinc-400' }] : []), ...(Array.isArray(t.tags) ? (t.tags as unknown[]).filter((x) => typeof x === 'string').slice(0, 3).map((x) => ({ text: `#${x}`, cls: 'text-zinc-400 dark:text-zinc-500' })) : [])],
        })),
      };
    }
    case 'complete_tasks': {
      const list = toolItems(rec.args, ['tasks', 'task']);
      if (!list.length) return null;
      return {
        head: `完成 ${list.length} 个任务`,
        items: list.map((t) => ({
          title: str(t.title, 120) || `任务 #${t.id ?? '?'}`,
          badges: [{ text: '将标记为已完成', cls: 'text-zinc-400 dark:text-zinc-500' }],
        })),
      };
    }
    case 'create_schedules': {
      const list = toolItems(rec.args, ['schedules', 'schedule']);
      if (!list.length) return null;
      return {
        head: `创建 ${list.length} 条日程`,
        items: list.map((s) => ({
          title: str(s.title, 120),
          badges: [
            ...(validDate(s.date) ? [{ text: validDate(s.date)!, cls: 'text-zinc-500 dark:text-zinc-400' }] : []),
            ...(validTime(s.start_time) ? [{ text: `${s.start_time}${validTime(s.end_time) ? `–${s.end_time}` : ''}`, cls: 'text-zinc-500 dark:text-zinc-400' }] : []),
          ],
        })),
      };
    }
    case 'create_inspirations': {
      const list = toolItems(rec.args, ['inspirations', 'inspiration'], 'content');
      if (!list.length) return null;
      return {
        head: `记录 ${list.length} 条灵感`,
        items: list.map((s) => ({
          title: str(s.content, 120),
          badges: [{ text: oneOf(INSPIRATION_CATEGORIES, s.category, '灵感'), cls: 'bg-rose-500/[0.16] font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-400' }],
        })),
      };
    }
    case 'update_tasks': {
      const list = toolItems(rec.args, ['tasks', 'task']);
      if (!list.length) return null;
      const zinc = 'text-zinc-500 dark:text-zinc-400';
      const muted = 'text-zinc-400 dark:text-zinc-500';
      return {
        head: `更新 ${list.length} 个任务`,
        items: list.map((t) => {
          const badges: { text: string; cls: string }[] = [];
          const rename = str(t.new_title, 120);
          if (rename) badges.push({ text: `原：${str(t.title, 40) || `#${t.id ?? '?'}`}`, cls: muted });
          if ('due_date' in t) {
            const d = validDate(t.due_date);
            badges.push(d ? { text: `截止 → ${d}`, cls: zinc } : { text: '清空截止', cls: zinc });
          }
          const pri = oneOfOrNull(TASK_PRIORITIES, t.priority);
          if (pri) badges.push({ text: `优先级 → ${PRIORITY_LABELS[pri]}`, cls: zinc });
          const cat = oneOfOrNull(TASK_CATEGORIES, t.category);
          if (cat) badges.push({ text: `分类 → ${cat}`, cls: CATEGORY_META[cat].chip });
          const status = oneOfOrNull(TASK_STATUSES, t.status);
          if (status) badges.push({ text: `状态 → ${status === 'done' ? '已完成' : status === 'in_progress' ? '进行中' : '待办'}`, cls: zinc });
          if ('estimated_minutes' in t) {
            badges.push(
              typeof t.estimated_minutes === 'number'
                ? { text: `时长 → ${t.estimated_minutes} 分钟`, cls: zinc }
                : { text: '清空时长', cls: zinc },
            );
          }
          if (Array.isArray(t.tags)) {
            for (const x of (t.tags as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3)) {
              badges.push({ text: `#${x}`, cls: muted });
            }
          }
          if (typeof t.description === 'string') badges.push({ text: '描述已更新', cls: muted });
          const edits: ToolItemEdit[] = [];
          const due = validDate(t.due_date);
          if (due) edits.push({ key: 'due_date', kind: 'date', value: due });
          if (pri) edits.push({ key: 'priority', kind: 'select', value: pri, options: TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })) });
          return { title: rename || str(t.title, 120) || `任务 #${t.id ?? '?'}`, badges, edits };
        }),
      };
    }
    case 'update_goals': {
      const list = toolItems(rec.args, ['goals', 'goal']);
      if (!list.length) return null;
      const zinc = 'text-zinc-500 dark:text-zinc-400';
      const muted = 'text-zinc-400 dark:text-zinc-500';
      return {
        head: `更新 ${list.length} 个目标`,
        items: list.map((g) => {
          const badges: { text: string; cls: string }[] = [];
          const rename = str(g.new_title, 120);
          if (rename) badges.push({ text: `原：${str(g.title, 40) || `#${g.id ?? '?'}`}`, cls: muted });
          if ('target_date' in g) {
            const d = validDate(g.target_date);
            badges.push(d ? { text: `目标日期 → ${d}`, cls: zinc } : { text: '清空目标日期', cls: zinc });
          }
          const cat = oneOfOrNull(TASK_CATEGORIES, g.category);
          if (cat) badges.push({ text: `分类 → ${cat}`, cls: CATEGORY_META[cat].chip });
          const status = oneOfOrNull(GOAL_STATUSES, g.status);
          if (status) badges.push({ text: `状态 → ${GOAL_STATUS_LABELS[status as GoalStatus]}`, cls: zinc });
          if (typeof g.note === 'string') badges.push({ text: '备注已更新', cls: muted });
          const edits: ToolItemEdit[] = [];
          const d = validDate(g.target_date);
          if (d) edits.push({ key: 'target_date', kind: 'date', value: d });
          return { title: rename || str(g.title, 120) || `目标 #${g.id ?? '?'}`, badges, edits };
        }),
      };
    }
    case 'delete_tasks': {
      const list = toolItems(rec.args, ['tasks', 'task']);
      if (!list.length) return null;
      const red = 'text-red-500 dark:text-red-400';
      return {
        head: `删除 ${list.length} 个任务`,
        danger: true,
        items: list.map((t) => ({
          title: str(t.title, 120) || `任务 #${t.id ?? '?'}`,
          badges: [
            { text: '不可恢复', cls: red },
            { text: '子任务一并删除', cls: red },
          ],
        })),
      };
    }
    case 'delete_schedules': {
      const list = toolItems(rec.args, ['schedules', 'schedule']);
      if (!list.length) return null;
      const red = 'text-red-500 dark:text-red-400';
      const zinc = 'text-zinc-500 dark:text-zinc-400';
      return {
        head: `删除 ${list.length} 条日程`,
        danger: true,
        items: list.map((s) => ({
          title: str(s.title, 120) || `日程 #${s.id ?? '?'}`,
          badges: [
            { text: '不可恢复', cls: red },
            ...(validDate(s.date) ? [{ text: validDate(s.date)!, cls: zinc }] : []),
          ],
        })),
      };
    }
    case 'delete_inspirations': {
      const list = toolItems(rec.args, ['inspirations', 'inspiration'], 'content');
      if (!list.length) return null;
      const red = 'text-red-500 dark:text-red-400';
      return {
        head: `删除 ${list.length} 条灵感`,
        danger: true,
        items: list.map((s) => ({
          title: str(s.content, 60) || `灵感 #${s.id ?? '?'}`,
          badges: [{ text: '不可恢复', cls: red }],
        })),
      };
    }
    case 'delete_goals': {
      const list = toolItems(rec.args, ['goals', 'goal']);
      if (!list.length) return null;
      const red = 'text-red-500 dark:text-red-400';
      const zinc = 'text-zinc-500 dark:text-zinc-400';
      return {
        head: `删除 ${list.length} 个目标`,
        danger: true,
        items: list.map((g) => ({
          title: str(g.title, 120) || `目标 #${g.id ?? '?'}`,
          badges: [
            { text: '不可恢复', cls: red },
            { text: '其下任务不删，仅解除关联', cls: zinc },
          ],
        })),
      };
    }
    default:
      return null;
  }
}

/** 只读工具（无副作用，免确认直接执行） */
export const isReadonlyTool = (name: ToolName): boolean => name === 'list_tasks';

const KNOWN_TOOLS = new Set<string>([
  'create_tasks',
  'list_tasks',
  'complete_tasks',
  'create_schedules',
  'create_inspirations',
  'update_tasks',
  'update_goals',
  'delete_tasks',
  'delete_schedules',
  'delete_inspirations',
  'delete_goals',
]);

/**
 * 坏调用的具体原因（会作为 tool 结果回传给模型，便于下一轮自我纠正）；null = 调用有效。
 * 报错必须带上模型实际发来的名字/参数预览，否则模型无从改起。
 */
export function badCallReason(rec: ToolCallRecord): string | null {
  if (rec.parseError) return rec.parseError;
  if (!KNOWN_TOOLS.has(rec.name)) {
    return `未知工具 "${rec.name}"：工具名必须与清单完全一致（复数形式，如 delete_tasks / update_tasks）`;
  }
  if (describeCall(rec) === null) {
    const preview = JSON.stringify(rec.args).slice(0, 120);
    return `${rec.name} 参数为空或格式不符，收到：${preview}。批量条目应放在 "tasks"/"goals"/"schedules"/"inspirations" 复数数组字段里`;
  }
  return null;
}

/* ===================== 工具定义（发给上游） ===================== */

export const CORGI_TOOLS: AiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_tasks',
      description:
        '批量创建任务（待办）。用户说"帮我记一下 / 帮我整理成任务 / 今天要做…"时使用，可一次创建多条。',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '任务列表',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '任务标题（必填，简洁的动宾短语，如"修改 BU 的 PPT 并上传"）' },
                category: { type: 'string', enum: [...TASK_CATEGORIES], description: '分类，默认"工作"' },
                priority: { type: 'string', enum: [...TASK_PRIORITIES], description: '优先级，默认 medium' },
                due_date: { type: 'string', description: '截止日期 YYYY-MM-DD，不填默认今天' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签（可选，每项 ≤12 字，最多 8 个）' },
                description: { type: 'string', description: '补充说明（可选）' },
                estimated_minutes: { type: 'number', description: '预计时长（分钟，可选）' },
              },
              required: ['title'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '查询任务列表（只读）。可按状态/分类/关键词过滤，或只看今天截止、已逾期。需要了解用户现有任务时先用这个。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: '状态筛选（可选）' },
          category: { type: 'string', enum: [...TASK_CATEGORIES], description: '分类筛选（可选）' },
          q: { type: 'string', description: '关键词搜索（可选）' },
          today: { type: 'boolean', description: '只看今天截止（可选）' },
          overdue: { type: 'boolean', description: '只看已逾期（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_tasks',
      description: '把任务标记为已完成。按 id 或标题精确匹配；找不到或同名多个时如实报告，不要猜测。',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '要完成的任务',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '任务 id（优先用这个）' },
                title: { type: 'string', description: '任务标题（与任务列表完全一致的全文）' },
              },
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_schedules',
      description: '批量创建日程（日历事件），如会议、约谈、提醒。',
      parameters: {
        type: 'object',
        properties: {
          schedules: {
            type: 'array',
            description: '日程列表',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '日程标题（必填）' },
                date: { type: 'string', description: '日期 YYYY-MM-DD（必填）' },
                start_time: { type: 'string', description: '开始时间 HH:mm（可选，全天日程不填）' },
                end_time: { type: 'string', description: '结束时间 HH:mm（可选）' },
                location: { type: 'string', description: '地点（可选）' },
                notes: { type: 'string', description: '备注（可选）' },
              },
              required: ['title', 'date'],
            },
          },
        },
        required: ['schedules'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_inspirations',
      description: '批量记录"此刻灵感"（随想、点子、备忘）。',
      parameters: {
        type: 'object',
        properties: {
          inspirations: {
            type: 'array',
            description: '灵感列表',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '内容（必填，≤500 字）' },
                category: { type: 'string', enum: [...INSPIRATION_CATEGORIES], description: '类型，默认"灵感"' },
              },
              required: ['content'],
            },
          },
        },
        required: ['inspirations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tasks',
      description:
        '修改任务属性（截止日期/优先级/分类/标签/改名/描述/预计时长/状态）。按 id 或标题精确匹配现有任务，只传需要修改的字段，未传的字段保持不变。',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '要修改的任务（最多 10 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '任务 id（优先用这个）' },
                title: { type: 'string', description: '现有任务标题（与任务列表完全一致的全文，用于匹配）' },
                new_title: { type: 'string', description: '新标题（改名时传）' },
                due_date: { type: 'string', description: '新截止日期 YYYY-MM-DD；传空字符串 "" 清除截止日期' },
                priority: { type: 'string', enum: [...TASK_PRIORITIES], description: '新优先级' },
                category: { type: 'string', enum: [...TASK_CATEGORIES], description: '新分类' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签整体替换，传完整新列表（每项 ≤20 字，最多 8 个）' },
                description: { type: 'string', description: '新描述' },
                estimated_minutes: { type: 'number', description: '新预计时长（分钟）' },
                status: { type: 'string', enum: [...TASK_STATUSES], description: '新状态（完成任务优先用 complete_tasks）' },
              },
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_goals',
      description: '修改目标属性（改名/备注/分类/目标日期/状态）。按 id 或标题精确匹配，只传要改的字段。',
      parameters: {
        type: 'object',
        properties: {
          goals: {
            type: 'array',
            description: '要修改的目标（最多 10 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '目标 id（优先用这个）' },
                title: { type: 'string', description: '现有目标标题（完全一致的全文，用于匹配）' },
                new_title: { type: 'string', description: '新标题（改名时传）' },
                note: { type: 'string', description: '新备注' },
                category: { type: 'string', enum: [...TASK_CATEGORIES], description: '新分类' },
                target_date: { type: 'string', description: '新目标日期 YYYY-MM-DD；传空字符串 "" 清除' },
                status: { type: 'string', enum: [...GOAL_STATUSES], description: '新状态' },
              },
            },
          },
        },
        required: ['goals'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_tasks',
      description:
        '删除任务（不可恢复，其子任务一并删除）。用户明确要求删除时才调用；按 id 或标题精确匹配，找不到或同名多个时如实报告。',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '要删除的任务（最多 5 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '任务 id（优先用这个）' },
                title: { type: 'string', description: '任务标题（与任务列表完全一致的全文）' },
              },
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_schedules',
      description:
        '删除日程。按 id 或 标题+日期 匹配（不传 date 时只在近 30 天至未来 180 天范围内找同名日程）。用户明确要求删除时才调用。',
      parameters: {
        type: 'object',
        properties: {
          schedules: {
            type: 'array',
            description: '要删除的日程（最多 5 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '日程 id（优先用这个）' },
                title: { type: 'string', description: '日程标题（完全一致的全文）' },
                date: { type: 'string', description: '日期 YYYY-MM-DD（强烈建议带上，避免同名歧义）' },
              },
            },
          },
        },
        required: ['schedules'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_inspirations',
      description:
        '删除"此刻灵感"。按 id 或内容匹配（先全文精确、再唯一子串；匹配到多条会失败）。用户明确要求删除时才调用。',
      parameters: {
        type: 'object',
        properties: {
          inspirations: {
            type: 'array',
            description: '要删除的灵感（最多 5 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '灵感 id（优先用这个）' },
                content: { type: 'string', description: '灵感内容全文或其中一段足够独特的文字' },
              },
            },
          },
        },
        required: ['inspirations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_goals',
      description:
        '删除目标（不可恢复；其下任务不会被删除，只解除关联）。用户明确要求删除时才调用；按 id 或标题精确匹配。',
      parameters: {
        type: 'object',
        properties: {
          goals: {
            type: 'array',
            description: '要删除的目标（最多 5 条）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '目标 id（优先用这个）' },
                title: { type: 'string', description: '目标标题（完全一致的全文）' },
              },
            },
          },
        },
        required: ['goals'],
      },
    },
  },
];

/** 追加进 system 的工具使用守则 */
export const CORGI_TOOLS_HINT = `你可以调用工具直接操作用户的任务系统（create_tasks / list_tasks / complete_tasks / update_tasks / create_schedules / create_inspirations / update_goals / delete_tasks / delete_schedules / delete_inspirations / delete_goals）。使用守则：
- 用户让你记录、整理任务/日程/灵感时，主动调用工具，不要只在回复里列清单。
- create_tasks 一次可带多条；标题用简洁的动宾短语；学习类内容记得 category 用"学习"。
- 需要了解用户现有的任务时先 list_tasks（只读，不用确认）。
- 修改任务/目标属性用 update_tasks / update_goals：按 id 或标题精确匹配，只传要改的字段；完成任务优先 complete_tasks。
- 删除是危险操作：只在用户明确说"删除/删掉"时调用 delete_*；要删哪些必须逐条列清楚交给用户确认，不要自行扩大范围；范围模糊时先问用户。
- 删除目标不会删除其下任务，只是解除关联。
- 所有按标题的匹配都是精确匹配，找不到或同名多个就如实报告并建议用 id，不要猜。
- 工具名与参数键必须与清单完全一致（复数形式，如 delete_tasks；条目放在 "tasks"/"goals"/"schedules"/"inspirations" 数组里）。不知道任务名时先 list_tasks。
- 工具执行结果会回传给你：写操作由用户确认后执行。收到结果后用一两句自然的话总结（说清成了几条、跳过或失败了几条即可，不要复述全部细节）。`;

/**
 * 柯基工具调用（function calling）：工具定义 + 前端执行器。
 * 后端只透传 tools 与 tool_calls（见 server/src/routes/ai.ts），执行全部在
 * 前端完成——写操作先经确认卡（用户勾选/微调标题）再走现有 REST API。
 */
import { format } from 'date-fns';
import { createTask, fetchTasks, updateTaskStatus, type TaskFilters } from '../api/tasks';
import { createSchedule } from '../api/schedules';
import { createInspiration } from '../api/inspirations';
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  INSPIRATION_CATEGORIES,
  CATEGORY_META,
  PRIORITY_LABELS,
  type TaskCategory,
  type TaskPriority,
  type TaskInput,
} from '../api/types';
import type { AiToolCall, AiToolDef } from '../api/ai';

export type ToolName = 'create_tasks' | 'list_tasks' | 'complete_tasks' | 'create_schedules' | 'create_inspirations';

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

/* ===================== 执行器 ===================== */

export interface ExecSelection {
  /** 勾选的条目下标（undefined = 全部执行） */
  selected?: number[];
  /** 用户微调后的标题：下标 → 新标题 */
  titleOverrides?: Record<number, string>;
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
      default:
        return { tool: rec.name, items: [], error: `未知工具：${rec.name}` };
    }
  } catch (e) {
    return { tool: rec.name, items: [], error: (e as Error).message };
  }
}

async function execCreateTasks(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(args.tasks, sel);
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
  const { picked, skipped } = pickItems<ItemArgs>(args.tasks, sel);
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

/** id 优先；仅标题时精确匹配（多个同名 → 报歧义，绝不猜） */
async function resolveTask(item: ItemArgs): Promise<{ id: number; title: string } | null> {
  const all = await fetchTasks({});
  if (typeof item.id === 'number') {
    const hit = all.find((t) => t.id === item.id);
    return hit ? { id: hit.id, title: hit.title } : null;
  }
  const title = str(item.title, 200);
  if (!title) return null;
  const hits = all.filter((t) => t.title === title && t.status !== 'done');
  if (hits.length !== 1) return null;
  return { id: hits[0].id, title: hits[0].title };
}

async function execCreateSchedules(args: Record<string, unknown>, sel: ExecSelection): Promise<ToolExecOutcome> {
  const { picked, skipped } = pickItems<ItemArgs>(args.schedules, sel);
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
  const { picked, skipped } = pickItems<ItemArgs>(args.inspirations, sel);
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

/* ===================== 确认卡展示辅助 ===================== */

export interface ToolItemView {
  title: string;
  badges: { text: string; cls: string }[];
}

/** 展开一次调用为确认卡的头部文案 + 条目（parseError / 空列表返回 null） */
export function describeCall(rec: ToolCallRecord): { head: string; items: ToolItemView[] } | null {
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
      const list = (Array.isArray(rec.args.tasks) ? rec.args.tasks : []) as ItemArgs[];
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
      const list = (Array.isArray(rec.args.tasks) ? rec.args.tasks : []) as ItemArgs[];
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
      const list = (Array.isArray(rec.args.schedules) ? rec.args.schedules : []) as ItemArgs[];
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
      const list = (Array.isArray(rec.args.inspirations) ? rec.args.inspirations : []) as ItemArgs[];
      if (!list.length) return null;
      return {
        head: `记录 ${list.length} 条灵感`,
        items: list.map((s) => ({
          title: str(s.content, 120),
          badges: [{ text: oneOf(INSPIRATION_CATEGORIES, s.category, '灵感'), cls: 'bg-rose-500/[0.16] font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-400' }],
        })),
      };
    }
    default:
      return null;
  }
}

/** 只读工具（无副作用，免确认直接执行） */
export const isReadonlyTool = (name: ToolName): boolean => name === 'list_tasks';

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
];

/** 追加进 system 的工具使用守则 */
export const CORGI_TOOLS_HINT = `你可以调用工具直接操作用户的任务系统（create_tasks / list_tasks / complete_tasks / create_schedules / create_inspirations）。使用守则：
- 用户让你记录、整理任务/日程/灵感时，主动调用工具，不要只在回复里列清单。
- create_tasks 一次可带多条；标题用简洁的动宾短语；学习类内容记得 category 用"学习"。
- 需要了解用户现有的任务时先 list_tasks（只读，不用确认）。
- complete_tasks 按 id 或标题精确匹配，找不到就如实说，不要猜。
- 工具执行结果会回传给你：写操作由用户确认后执行。收到结果后用一两句自然的话总结（说清成了几条、跳过或失败了几条即可，不要复述全部细节）。`;

export const TASK_CATEGORIES = ['工作', '学习', '生活', '其他'] as const;
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  estimated_minutes: number | null;
  tags: string[];
  goal_id: number | null;
  image_url: string | null;
  subtask_total: number;
  subtask_done: number;
  created_at: string;
  updated_at: string;
}

export interface SubtaskInput {
  title: string;
  done?: boolean;
}

export type TaskInput = Pick<
  Task,
  'title' | 'description' | 'category' | 'priority' | 'status' | 'due_date' | 'estimated_minutes' | 'tags' | 'goal_id' | 'image_url'
> & { subtasks: SubtaskInput[] };

export type GoalStatus = 'active' | 'done' | 'archived';

export interface Goal {
  id: number;
  title: string;
  note: string;
  category: TaskCategory;
  target_date: string | null;
  status: GoalStatus;
  image_url: string | null;
  task_total: number;
  task_done: number;
  created_at: string;
  updated_at: string;
}

export type GoalInput = Pick<Goal, 'title' | 'note' | 'category' | 'target_date' | 'status' | 'image_url'>;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: '进行中',
  done: '已完成',
  archived: '已归档',
};

export interface Schedule {
  id: number;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ScheduleInput = Pick<Schedule, 'title' | 'date' | 'start_time' | 'end_time' | 'location' | 'notes'>;

export const INSPIRATION_CATEGORIES = ['灵感', '工作', '生活', '心情'] as const;
export type InspirationCategory = (typeof INSPIRATION_CATEGORIES)[number];

export interface Inspiration {
  id: number;
  content: string;
  category: InspirationCategory;
  image_url: string | null;
  created_at: string;
  updated_at: string | null;
}

export type InspirationInput = Pick<Inspiration, 'content' | 'category' | 'image_url'>;

/** 灵感类型徽章（中性专业风） */
export const INSPIRATION_CATEGORY_META: Record<InspirationCategory, string> = {
  灵感: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  工作: 'bg-black/[0.06] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300',
  生活: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  心情: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
};

export interface StatsSummary {
  today: {
    total: number;
    todo: number;
    in_progress: number;
    done: number;
    completion_rate: number;
    schedules_count: number;
  };
  overdue_count: number;
}

export interface DailyCompletion {
  date: string;
  completed: number;
}

export interface CategoryStat {
  category: string;
  total: number;
  done: number;
  completion_rate: number;
}

// ---- 展示映射 ----
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

/** 分类展示：中性徽章（专业风） */
export const CATEGORY_META: Record<string, { chip: string }> = {
  工作: { chip: 'bg-black/[0.06] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300' },
  学习: { chip: 'bg-black/[0.06] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300' },
  生活: { chip: 'bg-black/[0.06] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300' },
  其他: { chip: 'bg-black/[0.06] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300' },
};

/** 优先级圆点颜色 */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-zinc-400',
  low: 'bg-zinc-300 dark:bg-zinc-600',
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  todo: 'bg-black/[0.06] text-zinc-500 dark:bg-white/[0.08] dark:text-zinc-400',
  in_progress: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  done: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
};

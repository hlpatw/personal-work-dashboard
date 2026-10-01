export const TASK_CATEGORIES = ['工作', '学习', '生活', '其他'] as const;
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: number;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskInput = Pick<Task, 'title' | 'description' | 'category' | 'priority' | 'status' | 'due_date'>;

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

/** 优先级圆点颜色 */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-zinc-400',
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  todo: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
};

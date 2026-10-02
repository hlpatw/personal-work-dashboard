export const TASK_CATEGORIES = ['工作', '学习', '生活', '其他'] as const;
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export const INSPIRATION_CATEGORIES = ['灵感', '工作', '生活', '心情'] as const;

declare global {
  namespace Express {
    interface Request {
      /** 当前请求归属的用户 id，由 app.ts 的用户中间件注入（多账号扩展接缝） */
      userId?: number;
    }
  }
}

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type InspirationCategory = (typeof INSPIRATION_CATEGORIES)[number];

export interface Inspiration {
  id: number;
  content: string;
  category: InspirationCategory;
  created_at: string;
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
  subtask_total: number;
  subtask_done: number;
  created_at: string;
  updated_at: string;
}

export interface SubtaskInput {
  title: string;
  done?: boolean;
}

export interface Subtask extends SubtaskInput {
  id: number;
  task_id: number;
  done: boolean;
  sort_order: number;
}

export type GoalStatus = 'active' | 'done' | 'archived';

export interface Goal {
  id: number;
  title: string;
  note: string;
  target_date: string | null;
  status: GoalStatus;
  task_total: number;
  task_done: number;
  created_at: string;
  updated_at: string;
}

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

export interface TodaySummary {
  total: number;
  todo: number;
  in_progress: number;
  done: number;
  completion_rate: number;
  schedules_count: number;
}

export interface StatsSummary {
  today: TodaySummary;
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

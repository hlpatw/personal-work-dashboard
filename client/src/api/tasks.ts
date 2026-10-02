import { request, qs } from './client';
import type { Task, TaskInput, TaskStatus, Subtask } from './types';

export interface TaskFilters {
  status?: TaskStatus | '';
  category?: string;
  priority?: string;
  q?: string;
  tag?: string;
  goalId?: number;
  overdue?: boolean;
}

export function fetchTasks(filters: TaskFilters = {}): Promise<Task[]> {
  return request<Task[]>(
    `/api/tasks${qs({
      status: filters.status,
      category: filters.category,
      priority: filters.priority,
      q: filters.q,
      tag: filters.tag,
      goalId: filters.goalId,
      overdue: filters.overdue ? 1 : undefined,
    })}`
  );
}

export function fetchSubtasks(taskId: number): Promise<Subtask[]> {
  return request<Subtask[]>(`/api/tasks/${taskId}/subtasks`);
}

export function createTask(input: TaskInput): Promise<Task> {
  return request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTask(id: number, input: TaskInput): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function updateTaskStatus(id: number, status: TaskStatus): Promise<Task> {
  return request<Task>(`/api/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export function deleteTask(id: number): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}

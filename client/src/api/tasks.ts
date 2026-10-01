import { request, qs } from './client';
import type { Task, TaskInput, TaskStatus } from './types';

export interface TaskFilters {
  status?: TaskStatus | '';
  category?: string;
  priority?: string;
  q?: string;
  overdue?: boolean;
}

export function fetchTasks(filters: TaskFilters = {}): Promise<Task[]> {
  return request<Task[]>(
    `/api/tasks${qs({
      status: filters.status,
      category: filters.category,
      priority: filters.priority,
      q: filters.q,
      overdue: filters.overdue ? 1 : undefined,
    })}`
  );
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

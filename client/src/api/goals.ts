import { request, qs } from './client';
import type { Goal, GoalInput, GoalStatus } from './types';

export function fetchGoals(status?: GoalStatus | ''): Promise<Goal[]> {
  return request<Goal[]>(`/api/goals${qs({ status })}`);
}

export function createGoal(input: GoalInput): Promise<Goal> {
  return request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(input) });
}

export function updateGoal(id: number, input: GoalInput): Promise<Goal> {
  return request<Goal>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function updateGoalStatus(id: number, status: GoalStatus): Promise<Goal> {
  return request<Goal>(`/api/goals/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export function deleteGoal(id: number): Promise<void> {
  return request<void>(`/api/goals/${id}`, { method: 'DELETE' });
}

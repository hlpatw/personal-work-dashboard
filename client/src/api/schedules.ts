import { request, qs } from './client';
import type { Schedule, ScheduleInput } from './types';

export function fetchSchedulesByRange(from: string, to: string): Promise<Schedule[]> {
  return request<Schedule[]>(`/api/schedules${qs({ from, to })}`);
}

export function fetchTodaySchedules(): Promise<Schedule[]> {
  return request<Schedule[]>('/api/schedules/today');
}

export function createSchedule(input: ScheduleInput): Promise<Schedule> {
  return request<Schedule>('/api/schedules', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSchedule(id: number, input: ScheduleInput): Promise<Schedule> {
  return request<Schedule>(`/api/schedules/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSchedule(id: number): Promise<void> {
  return request<void>(`/api/schedules/${id}`, { method: 'DELETE' });
}

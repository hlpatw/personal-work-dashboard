import { request, qs } from './client';
import type { StatsSummary, DailyCompletion, CategoryStat } from './types';

export function fetchSummary(): Promise<StatsSummary> {
  return request<StatsSummary>('/api/stats/summary');
}

export function fetchDailyCompletions(days = 90): Promise<DailyCompletion[]> {
  return request<DailyCompletion[]>(`/api/stats/completions/daily${qs({ days })}`);
}

export function fetchCategoryStats(): Promise<CategoryStat[]> {
  return request<CategoryStat[]>('/api/stats/categories');
}

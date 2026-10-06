import { request, qs } from './client';
import type { Inspiration, InspirationInput } from './types';

export function fetchInspirations(filters: { q?: string; category?: string } = {}): Promise<Inspiration[]> {
  return request<Inspiration[]>(`/api/inspirations${qs({ q: filters.q, category: filters.category })}`);
}

export function createInspiration(input: InspirationInput): Promise<Inspiration> {
  return request<Inspiration>('/api/inspirations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateInspiration(id: number, input: InspirationInput): Promise<Inspiration> {
  return request<Inspiration>(`/api/inspirations/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteInspiration(id: number): Promise<void> {
  return request<void>(`/api/inspirations/${id}`, { method: 'DELETE' });
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTasks, updateTaskStatus, deleteTask, type TaskFilters } from '../api/tasks';
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_DOT,
  STATUS_BADGE,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from '../api/types';
import { formatCN, todayStr } from '../lib/date';
import TaskFormDialog from '../components/TaskFormDialog';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const selectCls =
  'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800';

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskFilters>({ status: '', category: '', priority: '', q: '' });
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: tasks, isLoading, isError, error } = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => fetchTasks(filters),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => updateTaskStatus(id, status),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: invalidate,
  });

  const today = todayStr();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">任务</h1>
        <input
          className={`${selectCls} w-40`}
          placeholder="搜索标题/描述…"
          value={filters.q ?? ''}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className={selectCls}
          value={filters.status ?? ''}
          onChange={(e) => setFilters({ ...filters, status: (e.target.value || '') as TaskStatus | '' })}
        >
          <option value="">全部状态</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={filters.category ?? ''}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
        >
          <option value="">全部分类</option>
          {TASK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          ＋ 新建任务
        </button>
      </div>

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-zinc-400">加载中…</div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-red-500">{(error as Error).message}</div>
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState text="没有符合条件的任务" />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tasks.map((task) => {
              const overdue = task.status !== 'done' && task.due_date !== null && task.due_date < today;
              return (
                <li key={task.id} className="group flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() =>
                      toggleMutation.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })
                    }
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      task.status === 'done'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-zinc-300 hover:border-indigo-500 dark:border-zinc-600'
                    }`}
                    aria-label={task.status === 'done' ? '标记为待办' : '标记为完成'}
                  >
                    {task.status === 'done' && <span className="text-xs">✓</span>}
                  </button>

                  <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} title={`优先级：${PRIORITY_LABELS[task.priority]}`} />

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${task.status === 'done' ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">{task.description}</p>
                    )}
                  </div>

                  <span className="hidden rounded px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
                    {task.category}
                  </span>
                  <span className={`hidden rounded px-1.5 py-0.5 text-xs sm:inline ${STATUS_BADGE[task.status]}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                  {task.due_date && (
                    <span className={`text-xs ${overdue ? 'font-medium text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                      {overdue ? '逾期 ' : ''}
                      {formatCN(task.due_date, 'M月d日')}
                    </span>
                  )}

                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(task)}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定删除「${task.title}」吗？`)) deleteMutation.mutate(task.id);
                      }}
                      className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {(creating || editing) && (
        <TaskFormDialog task={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
    </div>
  );
}

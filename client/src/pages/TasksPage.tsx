import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { formatDuration } from '../lib/format';
import TaskFormDialog from '../components/TaskFormDialog';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import { IconClock, IconPencil, IconTrash } from '../components/icons';

const selectCls =
  'rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-rose-500 dark:border-stone-700 dark:bg-stone-800';

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskFilters>({ status: '', category: '', priority: '', q: '' });
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  // 支持 URL 参数预筛选（如概览卡片跳转 /tasks?status=todo）
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  useEffect(() => {
    if (statusParam && (TASK_STATUSES as readonly string[]).includes(statusParam)) {
      setFilters((f) => ({ ...f, status: statusParam as TaskStatus }));
    }
  }, [statusParam]);

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
      <PageHeader
        title="任务"
        subtitle={tasks ? `共 ${tasks.length} 项` : '…'}
        actions={
          <>
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
              className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm shadow-rose-600/20 transition-colors hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
            >
              ＋ 新建任务
            </button>
          </>
        }
      />

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-stone-400">加载中…</div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-red-500">{(error as Error).message}</div>
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState text="没有符合条件的任务" />
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
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
                        : 'border-stone-300 hover:border-rose-500 dark:border-stone-600'
                    }`}
                    aria-label={task.status === 'done' ? '标记为待办' : '标记为完成'}
                  >
                    {task.status === 'done' && <span className="text-xs">✓</span>}
                  </button>

                  <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} title={`优先级：${PRIORITY_LABELS[task.priority]}`} />

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${task.status === 'done' ? 'text-stone-400 line-through dark:text-stone-500' : ''}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="truncate text-xs text-stone-400 dark:text-stone-500">{task.description}</p>
                    )}
                  </div>

                  <span className="hidden rounded px-1.5 py-0.5 text-xs text-stone-500 dark:text-stone-400 sm:inline">
                    {task.category}
                  </span>
                  <span className={`hidden rounded px-1.5 py-0.5 text-xs sm:inline ${STATUS_BADGE[task.status]}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                  {task.estimated_minutes !== null && task.estimated_minutes > 0 && (
                    <span className="hidden items-center gap-1 text-xs text-stone-400 dark:text-stone-500 sm:inline-flex" title={`预计 ${formatDuration(task.estimated_minutes)}`}>
                      <IconClock />
                      {formatDuration(task.estimated_minutes)}
                    </span>
                  )}
                  {task.due_date && (
                    <span className={`text-xs ${overdue ? 'font-medium text-red-500' : 'text-stone-400 dark:text-stone-500'}`}>
                      {overdue ? '逾期 ' : ''}
                      {formatCN(task.due_date, 'M月d日')}
                    </span>
                  )}

                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(task)}
                      className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                      title="编辑"
                    >
                      <IconPencil />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定删除「${task.title}」吗？`)) deleteMutation.mutate(task.id);
                      }}
                      className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                      title="删除"
                    >
                      <IconTrash />
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

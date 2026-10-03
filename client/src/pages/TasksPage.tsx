import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTasks, updateTaskStatus, deleteTask, type TaskFilters } from '../api/tasks';
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_DOT,
  STATUS_BADGE,
  CATEGORY_META,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from '../api/types';
import { formatCN, todayStr } from '../lib/date';
import { formatDuration } from '../lib/format';
import TaskFormDialog from '../components/TaskFormDialog';
import Lightbox from '../components/Lightbox';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import { IconClock, IconPencil, IconTrash } from '../components/icons';

const selectCls =
  'rounded-lg bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 outline-none transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-200 dark:hover:bg-[#26262b]';

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskFilters>({ status: '', category: '', priority: '', q: '' });
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // 支持 URL 参数预筛选（概览卡片 /tasks?status=todo、目标卡 /tasks?goal=1）
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const goalParam = searchParams.get('goal');
  const tagParam = searchParams.get('tag');
  useEffect(() => {
    if (statusParam && (TASK_STATUSES as readonly string[]).includes(statusParam)) {
      setFilters((f) => ({ ...f, status: statusParam as TaskStatus }));
    }
  }, [statusParam]);
  useEffect(() => {
    if (goalParam) {
      setFilters((f) => ({ ...f, goalId: Number(goalParam) }));
    }
  }, [goalParam]);
  useEffect(() => {
    if (tagParam) {
      setFilters((f) => ({ ...f, tag: tagParam }));
    }
  }, [tagParam]);

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
            {filters.tag && (
              <button
                onClick={() => setFilters((f) => ({ ...f, tag: undefined }))}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-sm text-rose-500 transition-colors hover:bg-rose-500/15 dark:text-rose-400"
                title="清除标签筛选"
              >
                #{filters.tag} ✕
              </button>
            )}
            {filters.goalId && (
              <button
                onClick={() => setFilters((f) => ({ ...f, goalId: undefined }))}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-300 dark:hover:bg-[#26262b]"
                title="清除目标筛选"
              >
                目标 #{filters.goalId} ✕
              </button>
            )}
            <button
              onClick={() => setCreating(true)}
              className="rounded-lg bg-rose-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
            >
              ＋ 新建任务
            </button>
          </>
        }
      />

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-zinc-400">加载中…</div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-red-500">{(error as Error).message}</div>
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState text="没有符合条件的任务" />
        ) : (
          <ul className="flex flex-col gap-2 p-3">
            {tasks.map((task) => {
              const overdue = task.status !== 'done' && task.due_date !== null && task.due_date < today;
              const meta = CATEGORY_META[task.category] ?? CATEGORY_META['其他'];
              return (
                <li
                  key={task.id}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-100/80 dark:hover:bg-[#1f1f24]"
                >
                  <button
                    onClick={() =>
                      toggleMutation.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })
                    }
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                      task.status === 'done'
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : 'border-zinc-300 hover:border-rose-400 dark:border-zinc-600'
                    }`}
                    aria-label={task.status === 'done' ? '标记为待办' : '标记为完成'}
                  >
                    {task.status === 'done' && <span className="check-pop text-xs">✓</span>}
                  </button>

                  <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} title={`优先级：${PRIORITY_LABELS[task.priority]}`} />

                  {task.image_url && (
                    <img
                      src={task.image_url}
                      alt=""
                      className="h-7 w-7 shrink-0 cursor-zoom-in rounded-md object-cover ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightbox(task.image_url!);
                      }}
                      title="查看配图"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${task.status === 'done' ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>
                      {task.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                      {task.description && <span className="max-w-[24rem] truncate">{task.description}</span>}
                      {task.subtask_total > 0 && (
                        <span className="inline-flex items-center gap-1.5" title={`子任务 ${task.subtask_done}/${task.subtask_total}`}>
                          <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
                            <span
                              className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-300"
                              style={{ width: `${(task.subtask_done / task.subtask_total) * 100}%` }}
                            />
                          </span>
                          {task.subtask_done}/{task.subtask_total}
                        </span>
                      )}
                      {task.tags.map((t) => (
                        <span
                          key={t}
                          className="cursor-pointer rounded px-1.5 py-px text-[11px] text-zinc-500 ring-1 ring-inset ring-black/[0.07] transition-colors hover:text-rose-500 hover:ring-rose-400/40 dark:text-zinc-400 dark:ring-white/[0.09] dark:hover:text-rose-400"
                          onClick={() => setFilters((f) => ({ ...f, tag: t }))}
                          title={`按标签「${t}」筛选`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <span className={`hidden shrink-0 rounded-md px-2 py-0.5 text-xs sm:inline ${meta.chip}`}>
                    {task.category}
                  </span>
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs sm:inline ${STATUS_BADGE[task.status]}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                  {task.estimated_minutes !== null && task.estimated_minutes > 0 && (
                    <span className="hidden shrink-0 items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 sm:inline-flex" title={`预计 ${formatDuration(task.estimated_minutes)}`}>
                      <IconClock />
                      {formatDuration(task.estimated_minutes)}
                    </span>
                  )}
                  {task.due_date && (
                    <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                      {overdue ? '逾期 ' : ''}
                      {formatCN(task.due_date, 'M月d日')}
                    </span>
                  )}

                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(task)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
                      title="编辑"
                    >
                      <IconPencil />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定删除「${task.title}」吗？`)) deleteMutation.mutate(task.id);
                      }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 dark:hover:bg-red-500/15"
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
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

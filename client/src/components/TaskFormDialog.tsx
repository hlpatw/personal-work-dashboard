import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { createTask, updateTask, fetchSubtasks } from '../api/tasks';
import { fetchGoals } from '../api/goals';
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  STATUS_LABELS,
  PRIORITY_LABELS,
  type Task,
  type TaskInput,
  type SubtaskInput,
} from '../api/types';

const inputCls =
  'w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100';

interface Props {
  task: Task | null; // null = 新建
  onClose: () => void;
  /** 新建时预填标题（如"灵感转任务"场景） */
  initialTitle?: string;
}

export default function TaskFormDialog({ task, onClose, initialTitle }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [tagDraft, setTagDraft] = useState((task?.tags ?? []).join('，'));
  const [form, setForm] = useState<Omit<TaskInput, 'tags' | 'subtasks'>>({
    title: task?.title ?? initialTitle ?? '',
    description: task?.description ?? '',
    category: task?.category ?? '工作',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'todo',
    due_date: task?.due_date ?? null,
    estimated_minutes: task?.estimated_minutes ?? null,
    goal_id: task?.goal_id ?? null,
  });
  const [subtasks, setSubtasks] = useState<SubtaskInput[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState('');

  // 编辑时拉取已有子任务填充
  const { data: existingSubs } = useQuery({
    queryKey: ['subtasks', task?.id],
    queryFn: () => fetchSubtasks(task!.id),
    enabled: !!task,
  });
  useEffect(() => {
    if (existingSubs && subtasks.length === 0) {
      setSubtasks(existingSubs.map((s) => ({ title: s.title, done: s.done })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSubs]);

  const { data: goals } = useQuery({ queryKey: ['goals'], queryFn: () => fetchGoals() });

  const mutation = useMutation({
    mutationFn: (input: TaskInput) => (task ? updateTask(task.id, input) : createTask(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const addSubtask = () => {
    const t = subtaskDraft.trim();
    if (!t || subtasks.length >= 50) return;
    setSubtasks([...subtasks, { title: t, done: false }]);
    setSubtaskDraft('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('请填写标题');
      return;
    }
    setError('');
    const tags = tagDraft
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    mutation.mutate({ ...form, tags, subtasks: subtasks.filter((s) => s.title.trim()) });
  };

  return (
    <Modal title={task ? '编辑任务' : '新建任务'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">标题 *</label>
          <input
            autoFocus
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="要做什么？"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">描述</label>
          <textarea
            className={`${inputCls} h-20 resize-none`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="补充说明（可选）"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">分类</label>
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as TaskInput['category'] })}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">优先级</label>
            <select
              className={inputCls}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as TaskInput['priority'] })}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">截止日期</label>
            <input
              type="date"
              className={inputCls}
              value={form.due_date ?? ''}
              onChange={(e) => setForm({ ...form, due_date: e.target.value || null })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">预计时长（分钟）</label>
            <input
              type="number"
              min={0}
              step={5}
              className={inputCls}
              value={form.estimated_minutes ?? ''}
              onChange={(e) =>
                setForm({ ...form, estimated_minutes: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="如 45"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-zinc-500">关联目标</label>
            <select
              className={inputCls}
              value={form.goal_id ?? ''}
              onChange={(e) => setForm({ ...form, goal_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">不关联</option>
              {(goals ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">标签（逗号分隔，最多 8 个）</label>
          <input
            className={inputCls}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder="如：重要，联调"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">子任务清单</label>
          <div className="space-y-1.5">
            {subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubtasks(subtasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                    s.done ? 'border-rose-500 bg-rose-500 text-white' : 'border-zinc-300 dark:border-zinc-600'
                  }`}
                  aria-label="切换子任务完成"
                >
                  {s.done && <span className="text-[10px]">✓</span>}
                </button>
                <input
                  className={`${inputCls} flex-1`}
                  value={s.title}
                  onChange={(e) =>
                    setSubtasks(subtasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-md px-1.5 text-xs text-zinc-400 hover:bg-black/[0.05] hover:text-red-400 dark:hover:bg-white/[0.06]"
                  aria-label="删除子任务"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
                placeholder="添加子任务，回车确认"
              />
              <button
                type="button"
                onClick={addSubtask}
                className="shrink-0 rounded-lg bg-zinc-100 px-3 text-sm text-zinc-500 transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-300 dark:hover:bg-[#26262b]"
              >
                添加
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">状态</label>
          <select
            className={inputCls}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as TaskInput['status'] })}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-50"
          >
            {mutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

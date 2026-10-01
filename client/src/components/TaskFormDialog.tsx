import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { createTask, updateTask } from '../api/tasks';
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  STATUS_LABELS,
  PRIORITY_LABELS,
  type Task,
  type TaskInput,
} from '../api/types';

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800';

interface Props {
  task: Task | null; // null = 新建
  onClose: () => void;
}

export default function TaskFormDialog({ task, onClose }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState<TaskInput>({
    title: task?.title ?? '',
    description: task?.description ?? '',
    category: task?.category ?? '工作',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'todo',
    due_date: task?.due_date ?? null,
  });

  const mutation = useMutation({
    mutationFn: (input: TaskInput) => (task ? updateTask(task.id, input) : createTask(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('请填写标题');
      return;
    }
    setError('');
    mutation.mutate(form);
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
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-50"
          >
            {mutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

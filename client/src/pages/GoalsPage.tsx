import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchGoals, createGoal, updateGoal, updateGoalStatus, deleteGoal } from '../api/goals';
import {
  GOAL_STATUS_LABELS,
  TASK_CATEGORIES,
  CATEGORY_META,
  type Goal,
  type GoalInput,
  type GoalStatus,
} from '../api/types';
import { todayStr, formatCN, toDateStr, addDaysStr } from '../lib/date';
import { useCountUp } from '../lib/useCountUp';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Card from '../components/Card';
import ImageInput from '../components/ImageInput';
import Lightbox from '../components/Lightbox';
import { IconPencil, IconTrash } from '../components/icons';

const inputCls =
  'w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100';

/** 剩余天数：正数=还有 N 天，0=今天，负数=已过 N 天 */
function daysLeft(target: string | null): number | null {
  if (!target) return null;
  const today = new Date(todayStr());
  const t = new Date(target);
  return Math.round((t.getTime() - today.getTime()) / 86400000);
}

export default function GoalsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<GoalStatus | ''>('');
  // undefined=弹窗关闭；null=新建；Goal=编辑该目标
  const [dialogGoal, setDialogGoal] = useState<Goal | null | undefined>(undefined);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: goals, isLoading, isError, error } = useQuery({
    queryKey: ['goals', statusFilter],
    queryFn: () => fetchGoals(statusFilter),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['goals'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: GoalStatus }) => updateGoalStatus(id, status),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGoal(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const active = (goals ?? []).filter((g) => g.status === 'active');
  const finished = (goals ?? []).filter((g) => g.status !== 'active');

  return (
    <div className="space-y-4">
      <PageHeader
        title="目标"
        subtitle={goals ? `${active.length} 个进行中 · ${finished.length} 个已结束` : '…'}
        actions={
          <>
            <select
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 outline-none transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-200 dark:hover:bg-[#26262b]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as GoalStatus | '')}
            >
              <option value="">全部状态</option>
              <option value="active">进行中</option>
              <option value="done">已完成</option>
              <option value="archived">已归档</option>
            </select>
            <button
              onClick={() => setDialogGoal(null)}
              className="rounded-lg bg-rose-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
            >
              ＋ 新建目标
            </button>
          </>
        }
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">加载中…</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-500">{(error as Error).message}</div>
      ) : !goals || goals.length === 0 ? (
        <Card className="p-0">
          <EmptyState text="还没有长期目标，创建一个吧" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onStatus={(status) => statusMutation.mutate({ id: g.id, status })}
              onEdit={() => setDialogGoal(g)}
              onDelete={() => {
                if (window.confirm(`确定删除目标「${g.title}」吗？关联任务会自动解除关联。`)) {
                  deleteMutation.mutate(g.id);
                }
              }}
              onViewImage={(src) => setLightbox(src)}
            />
          ))}
        </div>
      )}

      {dialogGoal !== undefined && (
        <GoalFormDialog goal={dialogGoal} onClose={() => setDialogGoal(undefined)} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function GoalCard({
  goal,
  onStatus,
  onEdit,
  onDelete,
  onViewImage,
}: {
  goal: Goal;
  onStatus: (s: GoalStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewImage: (src: string) => void;
}) {
  const rate = goal.task_total === 0 ? 0 : Math.round((goal.task_done / goal.task_total) * 100);
  const animated = useCountUp(rate);
  const dl = daysLeft(goal.target_date);
  const urgent = dl !== null && dl < 0 && goal.status === 'active';
  const near = dl !== null && dl >= 0 && dl <= 7 && goal.status === 'active';

  return (
    <div className="group rounded-xl bg-white p-4 ring-1 ring-black/[0.05] transition-shadow hover:shadow-md hover:shadow-black/[0.04] dark:bg-[#17171b] dark:ring-white/[0.045] dark:hover:shadow-black/30">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`truncate text-sm font-medium ${goal.status === 'done' ? 'text-zinc-400 line-through' : ''}`}>
            {goal.title}
          </h3>
          {goal.note && (
            <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">{goal.note}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
            title="编辑"
          >
            <IconPencil />
          </button>
          {goal.status === 'active' ? (
            <button
              onClick={() => onStatus('done')}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-emerald-500 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-emerald-400"
              title="标记完成"
            >
              完成
            </button>
          ) : goal.status === 'done' ? (
            <button
              onClick={() => onStatus('active')}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] dark:text-zinc-400 dark:hover:bg-white/[0.06]"
              title="重新激活"
            >
              重开
            </button>
          ) : null}
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 dark:hover:bg-red-500/15"
            title="删除"
          >
            <IconTrash />
          </button>
        </div>
      </div>

      {goal.image_url && (
        <img
          src={goal.image_url}
          alt="目标配图"
          className="mt-2.5 max-h-44 w-full cursor-zoom-in rounded-lg object-cover ring-1 ring-black/[0.05] transition-opacity hover:opacity-90 dark:ring-white/[0.07]"
          onClick={() => onViewImage(goal.image_url!)}
        />
      )}

      {/* 进度 */}
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${goal.status === 'done' ? 'bg-emerald-500' : 'bg-rose-500'}`}
            style={{ width: `${rate}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {goal.task_done}/{goal.task_total} · {animated}%
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
          <span className={`rounded-md px-1.5 py-0.5 ${CATEGORY_META[goal.category]?.chip}`}>
            {goal.category}
          </span>
          {GOAL_STATUS_LABELS[goal.status]}
          {goal.target_date && <span className="ml-1">目标 {formatCN(goal.target_date, 'yyyy年M月d日')}</span>}
        </span>
        <span className="flex items-center gap-2">
          {dl !== null && goal.status === 'active' && (
            <span
              className={
                urgent
                  ? 'font-medium text-red-500'
                  : near
                    ? 'text-amber-500'
                    : 'text-zinc-400 dark:text-zinc-500'
              }
            >
              {urgent ? `已过 ${-dl} 天` : dl === 0 ? '就是今天' : `剩 ${dl} 天`}
            </span>
          )}
          {goal.task_total > 0 && (
            <Link
              to={`/tasks?goal=${goal.id}`}
              className="text-rose-500 hover:underline dark:text-rose-400"
            >
              查看任务 →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}

function GoalFormDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState<GoalInput>({
    title: goal?.title ?? '',
    note: goal?.note ?? '',
    category: goal?.category ?? '其他',
    target_date: goal?.target_date ?? addDaysStr(toDateStr(new Date()), 90),
    status: goal?.status ?? 'active',
    image_url: goal?.image_url ?? null,
  });

  const mutation = useMutation({
    mutationFn: (input: GoalInput) => (goal ? updateGoal(goal.id, input) : createGoal(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('请填写目标标题');
      return;
    }
    setError('');
    mutation.mutate(form);
  };

  return (
    <Modal title={goal ? '编辑目标' : '新建目标'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2.5">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">目标 *</label>
          <input
            autoFocus
            className={inputCls}
            value={form.title}
            maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="如：Q4 学完 React 基础"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">分类</label>
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as GoalInput['category'] })}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">目标日期</label>
            <input
              type="date"
              className={inputCls}
              value={form.target_date ?? ''}
              onChange={(e) => setForm({ ...form, target_date: e.target.value || null })}
            />
          </div>
        </div>
        {!goal && (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">默认 90 天后，可在任务里关联到该目标</p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">备注</label>
          <input
            className={inputCls}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="可选"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">配图（可选，可粘贴截图）</label>
          <ImageInput value={form.image_url} onChange={(v) => setForm({ ...form, image_url: v })} />
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
            {mutation.isPending ? '保存中…' : goal ? '保存' : '创建目标'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

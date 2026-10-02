import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { createSchedule, updateSchedule } from '../api/schedules';
import type { Schedule, ScheduleInput } from '../api/types';

const inputCls =
  'w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100';

interface Props {
  schedule: Schedule | null; // null = 新建
  defaultDate: string;
  onClose: () => void;
}

export default function ScheduleFormDialog({ schedule, defaultDate, onClose }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState<ScheduleInput>({
    title: schedule?.title ?? '',
    date: schedule?.date ?? defaultDate,
    start_time: schedule?.start_time ?? null,
    end_time: schedule?.end_time ?? null,
    location: schedule?.location ?? '',
    notes: schedule?.notes ?? '',
  });

  const mutation = useMutation({
    mutationFn: (input: ScheduleInput) => (schedule ? updateSchedule(schedule.id, input) : createSchedule(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
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
    <Modal title={schedule ? '编辑日程' : '新建日程'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">标题 *</label>
          <input
            autoFocus
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="日程安排"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">日期 *</label>
            <input
              type="date"
              className={inputCls}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">开始</label>
            <input
              type="time"
              className={inputCls}
              value={form.start_time ?? ''}
              onChange={(e) => setForm({ ...form, start_time: e.target.value || null })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">结束</label>
            <input
              type="time"
              className={inputCls}
              value={form.end_time ?? ''}
              onChange={(e) => setForm({ ...form, end_time: e.target.value || null })}
            />
          </div>
        </div>
        <div className="text-xs text-zinc-400">不填时间则视为全天事项</div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">地点</label>
          <input
            className={inputCls}
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="可选"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">备注</label>
          <textarea
            className={`${inputCls} h-16 resize-none`}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="可选"
          />
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

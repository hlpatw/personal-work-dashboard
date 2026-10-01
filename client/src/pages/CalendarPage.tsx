import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchSchedulesByRange, deleteSchedule } from '../api/schedules';
import type { Schedule } from '../api/types';
import { monthGridDays, toDateStr, todayStr, formatCN } from '../lib/date';
import ScheduleFormDialog from '../components/ScheduleFormDialog';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => new Date()); // 当前浏览的月份
  const [selected, setSelected] = useState(() => todayStr());
  const [dialog, setDialog] = useState<{ schedule: Schedule | null } | null>(null);

  const days = useMemo(() => monthGridDays(cursor), [cursor]);
  const range = useMemo(
    () => ({ from: toDateStr(days[0]), to: toDateStr(days[41]) }),
    [days]
  );

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['schedules', range.from, range.to],
    queryFn: () => fetchSchedulesByRange(range.from, range.to),
  });

  const byDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules ?? []) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [schedules]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const selectedList = byDate.get(selected) ?? [];
  const today = todayStr();

  return (
    <div className="space-y-4">
      {/* 月份切换 */}
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">
          {format(cursor, 'yyyy年M月', { locale: zhCN })}
        </h1>
        <button
          onClick={() => setCursor(addMonths(cursor, -1))}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          ←
        </button>
        <button
          onClick={() => {
            setCursor(new Date());
            setSelected(today);
          }}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          今天
        </button>
        <button
          onClick={() => setCursor(addMonths(cursor, 1))}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          →
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* 月历 */}
        <Card className="p-3">
          <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-stone-400 dark:text-stone-500">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const ds = toDateStr(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const dayList = byDate.get(ds) ?? [];
              const isSel = ds === selected;
              return (
                <button
                  key={ds}
                  onClick={() => setSelected(ds)}
                  className={`flex min-h-[72px] flex-col rounded-lg border p-1.5 text-left transition-colors ${
                    isSel
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10'
                      : 'border-transparent hover:border-stone-200 hover:bg-stone-50 dark:hover:border-stone-700 dark:hover:bg-stone-800/60'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      ds === today ? 'bg-rose-600 font-semibold text-white' : ''
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <div className="space-y-0.5 overflow-hidden">
                    {dayList.slice(0, 2).map((s) => (
                      <div
                        key={s.id}
                        className="truncate rounded bg-rose-100 px-1 py-0.5 text-[10px] leading-4 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                      >
                        {s.start_time ? `${s.start_time} ` : ''}
                        {s.title}
                      </div>
                    ))}
                    {dayList.length > 2 && (
                      <div className="px-1 text-[10px] text-stone-400">还有 {dayList.length - 2} 项…</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 选中日详情 */}
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{formatCN(selected)}</h2>
            <button
              onClick={() => setDialog({ schedule: null })}
              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm shadow-rose-600/20 transition-colors hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
            >
              ＋ 新增
            </button>
          </div>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-stone-400">加载中…</div>
          ) : selectedList.length === 0 ? (
            <EmptyState text="当日暂无日程" />
          ) : (
            <ul className="flex-1 space-y-2">
              {selectedList.map((s) => (
                <li
                  key={s.id}
                  className="group rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        {s.start_time ? `${s.start_time}${s.end_time ? ` – ${s.end_time}` : ''}` : '全天'}
                        {s.location && <span className="ml-2">📍 {s.location}</span>}
                      </p>
                      {s.notes && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{s.notes}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setDialog({ schedule: s })}
                        className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确定删除「${s.title}」吗？`)) deleteMutation.mutate(s.id);
                        }}
                        className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                        title="删除"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog && (
        <ScheduleFormDialog schedule={dialog.schedule} defaultDate={selected} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addWeeks, endOfWeek, format, startOfWeek, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchDailyCompletions, fetchSummary } from '../../api/stats';
import { fetchTasks } from '../../api/tasks';
import { CATEGORY_META } from '../../api/types';
import { formatCN, todayStr } from '../../lib/date';
import { buildWeeklyDigest } from '../../lib/corgiContext';
import { useCorgiChatStore } from '../../stores/corgiChat';
import Card from '../Card';

/** 统计页顶部的每周自动周报卡：纯前端拼装（周界与 StatsPage 同：周一起始） */
export default function WeeklyReportCard() {
  const setOpen = useCorgiChatStore((s) => s.setOpen);
  const send = useCorgiChatStore((s) => s.send);

  const { data: daily } = useQuery({ queryKey: ['stats', 'daily'], queryFn: () => fetchDailyCompletions(90) });
  const { data: tasks } = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => fetchTasks({}) });
  const { data: summary } = useQuery({ queryKey: ['stats', 'summary'], queryFn: fetchSummary });

  const week = useMemo(() => {
    const thisStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const thisEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
    const lastStart = addWeeks(thisStart, -1);
    const lastEnd = addWeeks(thisEnd, -1);
    const inRange = (d: string, from: Date, to: Date) => {
      const date = parseISO(d);
      return date >= from && date <= to;
    };

    // 每日完成（date 为 'YYYY-MM-DD'）
    const thisDaily = (daily ?? []).filter((d) => inRange(d.date, thisStart, thisEnd));
    const doneCount = thisDaily.reduce((s, d) => s + d.completed, 0);
    const lastDoneCount = (daily ?? [])
      .filter((d) => inRange(d.date, lastStart, lastEnd))
      .reduce((s, d) => s + d.completed, 0);
    const busiest = thisDaily.reduce((best, d) => (d.completed > (best?.completed ?? 0) ? d : best), undefined as { date: string; completed: number } | undefined);

    // 分类环比：本周 vs 上周完成任务的分类计数差
    const catCount = (from: Date, to: Date) => {
      const map = new Map<string, number>();
      for (const t of tasks ?? []) {
        if (t.status !== 'done' || !t.completed_at) continue;
        const d = t.completed_at.slice(0, 10);
        if (!inRange(d, from, to)) continue;
        map.set(t.category, (map.get(t.category) ?? 0) + 1);
      }
      return map;
    };
    const thisCats = catCount(thisStart, thisEnd);
    const lastCats = catCount(lastStart, lastEnd);
    const categoryChanges = [...new Set([...thisCats.keys(), ...lastCats.keys()])]
      .map((c) => ({ category: c, delta: (thisCats.get(c) ?? 0) - (lastCats.get(c) ?? 0) }))
      .filter((c) => c.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // 逾期（口径同概览页：未完成且截止日早于今天）
    const today = todayStr();
    const overdueTitles = (tasks ?? [])
      .filter((t) => t.status !== 'done' && t.due_date !== null && t.due_date < today)
      .slice(0, 3)
      .map((t) => t.title);
    const overdueCount = summary?.overdue_count ?? 0;

    return {
      rangeLabel: `${formatCN(thisStart, 'M月d日')}–${formatCN(thisEnd, 'M月d日')}`,
      doneCount,
      lastDoneCount,
      busiestDay: busiest && busiest.completed > 0 ? format(parseISO(busiest.date), 'EEEE', { locale: zhCN }) : null,
      busiestCount: busiest?.completed ?? 0,
      categoryChanges,
      overdueCount,
      overdueTitles,
    };
  }, [daily, tasks, summary]);

  const delta = week.doneCount - week.lastDoneCount;
  const deltaTone =
    delta === 0
      ? 'text-zinc-400 dark:text-zinc-500'
      : delta > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-500 dark:text-red-400';

  const comment = () => {
    setOpen(true);
    void send(
      buildWeeklyDigest({
        rangeLabel: week.rangeLabel,
        doneCount: week.doneCount,
        lastDoneCount: week.lastDoneCount,
        busiestDay: week.busiestDay,
        busiestCount: week.busiestCount,
        categoryChanges: week.categoryChanges,
        overdueTitles: week.overdueTitles,
      })
    );
  };

  if (week.doneCount === 0 && week.overdueCount === 0) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">本周周报</h2>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            {week.rangeLabel} · 本周还没有完成记录，从一件小事开始吧
          </p>
        </div>
        <button
          onClick={comment}
          className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/[0.16] dark:text-rose-400"
        >
          🐕 让柯基点评
        </button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">本周周报</h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{week.rangeLabel}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            完成 <b className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{week.doneCount}</b> 项
            <span className={`ml-1.5 font-medium tabular-nums ${deltaTone}`}>
              {delta === 0 ? '与上周持平' : `${delta > 0 ? '▲ +' : '▼ '}${delta} 较上周`}
            </span>
          </span>
          {week.busiestDay && (
            <span>
              最活跃 <b className="font-medium text-zinc-700 dark:text-zinc-200">{week.busiestDay}</b> · {week.busiestCount} 项
            </span>
          )}
          {week.categoryChanges.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {week.categoryChanges.map((c) => (
                <span
                  key={c.category}
                  className={`rounded px-1.5 py-0.5 font-medium ${CATEGORY_META[c.category]?.chip ?? CATEGORY_META['其他'].chip}`}
                >
                  {c.category} {c.delta > 0 ? `+${c.delta}` : c.delta}
                </span>
              ))}
            </span>
          )}
          {week.overdueCount > 0 ? (
            <span className="font-medium text-red-500 dark:text-red-400" title={week.overdueTitles.join('、')}>
              ⚠ 逾期 {week.overdueCount} 项待处理
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">无逾期 ✓</span>
          )}
        </div>
      </div>
      <button
        onClick={comment}
        className="shrink-0 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/[0.16] dark:text-rose-400"
      >
        🐕 让柯基点评
      </button>
    </Card>
  );
}

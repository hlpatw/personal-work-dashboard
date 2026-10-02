import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LabelList,
} from 'recharts';
import { startOfWeek, addWeeks, format, parseISO, isSameWeek } from 'date-fns';
import { fetchSummary, fetchDailyCompletions, fetchCategoryStats } from '../api/stats';
import { useThemeStore } from '../stores/theme';
import { formatCN } from '../lib/date';
import { useCountUp } from '../lib/useCountUp';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

// 图表颜色：已通过色盲安全与对比度验证
// （浅色基于 #ffffff 表面、深色基于 #1c1917 表面；分类槽位固定，色彩跟随实体）
const SERIES = {
  pink: { light: '#db2777', dark: '#ec4899' },
  blue: { light: '#2a78d6', dark: '#3987e5' },
  aqua: { light: '#1baf7a', dark: '#199e70' },
  yellow: { light: '#eda100', dark: '#c98500' },
};

const CATEGORY_COLORS: Record<string, { light: string; dark: string }> = {
  工作: SERIES.pink,
  学习: SERIES.blue,
  生活: SERIES.aqua,
  其他: SERIES.yellow,
};

const WEEKS = 12;

export default function StatsPage() {
  const theme = useThemeStore((s) => s.theme);
  const mode = theme === 'dark' ? 'dark' : 'light';
  const c = (pair: { light: string; dark: string }) => pair[mode];

  const { data: summary } = useQuery({ queryKey: ['stats', 'summary'], queryFn: fetchSummary });
  const { data: daily } = useQuery({
    queryKey: ['stats', 'daily'],
    queryFn: () => fetchDailyCompletions(90),
  });
  const { data: categories } = useQuery({
    queryKey: ['stats', 'categories'],
    queryFn: fetchCategoryStats,
  });

  // 周聚合（周一为一周开始），补齐空周
  const weeks = useMemo(() => {
    const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: WEEKS }, (_, i) => {
      const start = addWeeks(thisWeek, i - (WEEKS - 1));
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const completed = (daily ?? [])
        .filter((d) => {
          const date = parseISO(d.date);
          return isSameWeek(date, start, { weekStartsOn: 1 });
        })
        .reduce((sum, d) => sum + d.completed, 0);
      return {
        label: format(start, 'M/d'),
        range: `${formatCN(start, 'M月d日')} – ${formatCN(end, 'M月d日')}`,
        completed,
      };
    });
  }, [daily]);

  const maxWeek = Math.max(...weeks.map((w) => w.completed), 0);
  const thisWeekCount = weeks[weeks.length - 1]?.completed ?? 0;
  const lastWeekCount = weeks[weeks.length - 2]?.completed ?? 0;
  const weekDelta = thisWeekCount - lastWeekCount;

  const totalTasks = (categories ?? []).reduce((s, x) => s + x.total, 0);
  const totalDone = (categories ?? []).reduce((s, x) => s + x.done, 0);
  const overallRate = totalTasks === 0 ? 0 : Math.round((totalDone / totalTasks) * 100);

  // 表面与墨色（与卡片主题一致，暖石板基调）
  const surface = mode === 'dark' ? '#1c1917' : '#ffffff';
  const gridLine = mode === 'dark' ? '#2b2523' : '#f0e2e5';
  const axisInk = '#8f857c';
  const secondaryInk = mode === 'dark' ? '#c7c1b9' : '#55504a';

  const pieData = (categories ?? []).map((x) => ({ ...x, fill: c(CATEGORY_COLORS[x.category] ?? SERIES.pink) }));

  return (
    <div className="space-y-4">
      <PageHeader title="统计" subtitle={`近 ${WEEKS} 周完成趋势与分类总览`} />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="总完成率" value={overallRate} suffix="%" hint={`${totalDone} / ${totalTasks} 项任务`} />
        <StatCard
          label="本周完成"
          value={thisWeekCount}
          hint={weekDelta === 0 ? '与上周持平' : `较上周 ${weekDelta > 0 ? '+' : ''}${weekDelta}`}
          delta={weekDelta}
        />
        <StatCard label="逾期任务" value={summary?.overdue_count ?? 0} hint="未完成且已过截止日" />
        <StatCard label="任务总数" value={totalTasks} hint="全部任务（含已完成）" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 每周完成数 */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold">每周完成任务数</h2>
          <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">近 {WEEKS} 周（周一为每周第一天）</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeks} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={gridLine} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: axisInk, fontSize: 11 }}
                axisLine={{ stroke: gridLine }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: axisInk, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                contentStyle={{
                  background: surface,
                  border: `1px solid ${gridLine}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: secondaryInk,
                }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.range ?? ''}
                formatter={(value) => [`${value} 项`, '完成']}
              />
              <Bar
                dataKey="completed"
                fill={c(SERIES.pink)}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                {/* 只标注峰值周，其余交给坐标轴与悬浮提示 */}
                <LabelList
                  dataKey="completed"
                  position="top"
                  fontSize={11}
                  fill={secondaryInk}
                  formatter={(value) => {
                    const n = Number(value);
                    return n === maxWeek && n > 0 ? value : '';
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* 分类分布 */}
        <Card className="flex flex-col p-4">
          <h2 className="text-sm font-semibold">分类分布</h2>
          <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">各分类任务占比</p>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Tooltip
                contentStyle={{
                  background: surface,
                  border: `1px solid ${gridLine}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: secondaryInk,
                }}
                formatter={(value, name) => [`${value} 项`, name as string]}
              />
              <Pie
                data={pieData}
                dataKey="total"
                nameKey="category"
                innerRadius={58}
                outerRadius={88}
                stroke={surface}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.category} fill={entry.fill} />
                ))}
              </Pie>
              <Legend
                formatter={(value) => <span style={{ color: secondaryInk, fontSize: 12 }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* 分类明细表（图表的表格视图） */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">分类明细</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
              <th className="py-2 font-medium">分类</th>
              <th className="py-2 text-right font-medium">任务数</th>
              <th className="py-2 text-right font-medium">已完成</th>
              <th className="py-2 text-right font-medium">完成率</th>
            </tr>
          </thead>
          <tbody>
            {(categories ?? []).map((x) => (
              <tr key={x.category} className="border-b border-stone-100 last:border-0 dark:border-stone-800/60">
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: c(CATEGORY_COLORS[x.category] ?? SERIES.pink) }}
                    />
                    {x.category}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{x.total}</td>
                <td className="py-2 text-right tabular-nums">{x.done}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-500/20">
                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{ width: `${x.completion_rate}%` }}
                      />
                    </div>
                    <span className="w-9 text-right tabular-nums">{x.completion_rate}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {(categories ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-stone-400">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix = '',
  hint,
  delta,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint: string;
  delta?: number;
}) {
  const animated = useCountUp(value);
  const deltaTone =
    delta === undefined || delta === 0
      ? 'text-stone-400 dark:text-stone-500'
      : delta > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-500 dark:text-red-400';
  return (
    <Card className="p-4">
      <p className="text-xs text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">
        {animated}
        {suffix}
      </p>
      <p className={`mt-0.5 truncate text-xs ${deltaTone}`}>
        {delta !== undefined && delta !== 0 && <span className="mr-1">{delta > 0 ? '▲' : '▼'}</span>}
        {hint}
      </p>
    </Card>
  );
}

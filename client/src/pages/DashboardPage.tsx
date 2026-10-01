import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchTasks, updateTaskStatus } from '../api/tasks';
import { fetchTodaySchedules } from '../api/schedules';
import { fetchSummary } from '../api/stats';
import { PRIORITY_DOT, type Task } from '../api/types';
import { formatCN, todayStr } from '../lib/date';
import { useCountUp } from '../lib/useCountUp';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import ProgressRing from '../components/ProgressRing';

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const today = todayStr();

  const { data: summary } = useQuery({ queryKey: ['stats', 'summary'], queryFn: fetchSummary });
  const { data: allTasks } = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => fetchTasks({}) });
  const { data: todaySchedules } = useQuery({
    queryKey: ['schedules', 'today'],
    queryFn: fetchTodaySchedules,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) =>
      updateTaskStatus(id, done ? 'done' : 'todo'),
    onSuccess: invalidate,
  });

  // 逾期（未完成且截止日早于今天）+ 今日（截止今天，或今天创建且无截止日）
  const tasks = allTasks ?? [];
  const overdueTasks = tasks.filter((t) => t.status !== 'done' && t.due_date !== null && t.due_date < today);
  const todayTasks = tasks.filter(
    (t) =>
      t.status !== 'done' &&
      (t.due_date === today || (t.due_date === null && t.created_at.startsWith(today)))
  );
  const doneToday = tasks.filter((t) => t.status === 'done' && t.completed_at?.startsWith(today));

  // Bento 统计卡片：可点击跳转到对应筛选视图
  const cards = [
    {
      label: '今日待办',
      value: summary?.today.todo ?? 0,
      hint: `${summary?.today.total ?? 0} 项总计`,
      to: '/tasks?status=todo',
    },
    {
      label: '进行中',
      value: summary?.today.in_progress ?? 0,
      hint: '正在处理的任务',
      to: '/tasks?status=in_progress',
    },
    {
      label: '今日完成',
      value: summary?.today.done ?? 0,
      hint: `完成率 ${summary?.today.completion_rate ?? 0}%`,
      to: '/tasks?status=done',
      featured: true,
    },
    {
      label: '今日日程',
      value: summary?.today.schedules_count ?? 0,
      hint: formatCN(new Date(), 'M月d日'),
      to: '/calendar',
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">概览</h1>
        <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">
          {formatCN(new Date(), 'yyyy年M月d日 EEEE')}
          {(summary?.overdue_count ?? 0) > 0 && (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-500/20 dark:text-red-400">
              {summary?.overdue_count} 项逾期
            </span>
          )}
        </p>
      </div>

      {/* Bento 统计卡片（今日完成为主卡，占两列带进度环） */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            hint={c.hint}
            to={c.to}
            featured={c.featured}
            ringValue={summary?.today.completion_rate ?? 0}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 今日 + 逾期任务 */}
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">今日任务</h2>
            <Link to="/tasks" className="text-xs text-rose-600 hover:underline dark:text-rose-400">
              查看全部 →
            </Link>
          </div>
          {overdueTasks.length === 0 && todayTasks.length === 0 ? (
            <EmptyState text="今天没有待办，好好休息吧" />
          ) : (
            <ul className="space-y-1">
              {overdueTasks.map((t) => (
                <TaskRow key={t.id} task={t} overdue toggle={toggleMutation.mutate} />
              ))}
              {overdueTasks.length > 0 && todayTasks.length > 0 && (
                <div className="my-1 border-t border-dashed border-stone-200 dark:border-stone-800" />
              )}
              {todayTasks.map((t) => (
                <TaskRow key={t.id} task={t} toggle={toggleMutation.mutate} />
              ))}
            </ul>
          )}
        </Card>

        {/* 今日日程 */}
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">今日日程</h2>
            <Link to="/calendar" className="text-xs text-rose-600 hover:underline dark:text-rose-400">
              打开日历 →
            </Link>
          </div>
          {!todaySchedules || todaySchedules.length === 0 ? (
            <EmptyState text="今日暂无日程安排" icon="▤" />
          ) : (
            <ul className="relative space-y-3 pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-px before:bg-stone-200 dark:before:bg-stone-800">
              {todaySchedules.map((s) => (
                <li key={s.id} className="relative">
                  <span className="absolute -left-[13px] top-1.5 h-2 w-2 rounded-full bg-rose-500" />
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-xs font-medium text-rose-600 dark:text-rose-400">
                      {s.start_time ?? '全天'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{s.title}</p>
                      {s.location && (
                        <p className="text-xs text-stone-400 dark:text-stone-500">📍 {s.location}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 今日已完成 */}
      {doneToday.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">今日已完成（{doneToday.length}）</h2>
          <ul className="flex flex-wrap gap-2">
            {doneToday.map((t) => (
              <li
                key={t.id}
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 line-through dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                {t.title}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  to,
  featured = false,
  ringValue = 0,
}: {
  label: string;
  value: number;
  hint: string;
  to: string;
  featured?: boolean;
  ringValue?: number;
}) {
  const animated = useCountUp(value);
  return (
    <Link
      to={to}
      className={`group block rounded-2xl focus-visible:outline-none ${featured ? 'col-span-2' : ''}`}
      title={`查看${label}`}
    >
      <Card
        className={`h-full p-4 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-rose-500/10 group-focus-visible:ring-2 group-focus-visible:ring-rose-400/60 ${featured ? 'p-5' : ''}`}
      >
        <div className="flex h-full items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-stone-500 dark:text-stone-400">{label}</p>
            <p className={`mt-1 font-semibold tracking-tight ${featured ? 'text-3xl' : 'text-2xl'}`}>{animated}</p>
            <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{hint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {featured && <ProgressRing value={ringValue} size={72} stroke={7} />}
            <span className="text-stone-300 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-stone-500">
              →
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function TaskRow({
  task,
  overdue = false,
  toggle,
}: {
  task: Task;
  overdue?: boolean;
  toggle: (v: { id: number; done: boolean }) => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
      <button
        onClick={() => toggle({ id: task.id, done: true })}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-stone-300 hover:border-rose-500 dark:border-stone-600"
        aria-label="标记完成"
      />
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      {overdue && (
        <span className="shrink-0 text-xs font-medium text-red-500">
          逾期 {formatCN(task.due_date!, 'M月d日')}
        </span>
      )}
    </li>
  );
}

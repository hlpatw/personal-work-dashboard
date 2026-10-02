import { format, parseISO, startOfWeek, addDays, subDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';

/** 'YYYY-MM-DD' 本地日期字符串 */
export function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export function todayStr(): string {
  return toDateStr(new Date());
}

/** 月视图起始日（周一）对应的日期字符串 */
export function monthGridStart(d: Date): Date {
  return startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1), { weekStartsOn: 1 });
}

/** 月历 6×7 = 42 天 */
export function monthGridDays(d: Date): Date[] {
  const start = monthGridStart(d);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** '10月1日 周四' */
export function formatCN(d: Date | string, pattern = 'M月d日 EEEE'): string {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, pattern, { locale: zhCN });
}

export function isToday(d: Date): boolean {
  return toDateStr(d) === todayStr();
}

export function addDaysStr(dateStr: string, days: number): string {
  return toDateStr(days >= 0 ? addDays(parseISO(dateStr), days) : subDays(parseISO(dateStr), -days));
}

/** 相对时间："刚刚" / "N 分钟前" / "N 小时前" / "N 天前" / "M月d日"（超过 30 天） */
export function relativeTime(datetimeStr: string): string {
  const diffMs = Date.now() - new Date(datetimeStr.replace(' ', 'T')).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} 天前`;
  return formatCN(datetimeStr.slice(0, 10), 'yyyy年M月d日');
}

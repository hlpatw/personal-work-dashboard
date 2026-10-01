/** 分钟数转中文时长：45 → "45 分钟"，90 → "1 小时 30 分钟"，120 → "2 小时" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}

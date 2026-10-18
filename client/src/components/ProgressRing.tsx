interface Props {
  /** 0 - 100 */
  value: number;
  size?: number;
  stroke?: number;
}

/** 环形进度：填充 rose-500（嫩粉色块档），轨道用中性浅灰 */
export default function ProgressRing({ value, size = 56, stroke = 6 }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`完成率 ${clamped}%`}>
      {/* 轨道：中性浅灰，不与填充抢色 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-zinc-400/25 dark:stroke-zinc-500/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped / 100)}
        className="stroke-rose-500 -rotate-90"
        style={{ transformOrigin: 'center' }}
      />
    </svg>
  );
}

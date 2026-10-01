interface Props {
  /** 0 - 100 */
  value: number;
  size?: number;
  stroke?: number;
}

/** 环形进度：填充 indigo-500，轨道用同色系浅色阶 */
export default function ProgressRing({ value, size = 56, stroke = 6 }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`完成率 ${clamped}%`}>
      {/* 轨道：同色系浅阶 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-indigo-100 dark:stroke-indigo-500/20"
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
        className="stroke-indigo-500 -rotate-90"
        style={{ transformOrigin: 'center' }}
      />
    </svg>
  );
}

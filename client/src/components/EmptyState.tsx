export default function EmptyState({ text = '暂无数据' }: { text?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-400 dark:text-zinc-600">
      <span className="text-2xl opacity-60">○</span>
      <span className="text-sm">{text}</span>
    </div>
  );
}

export default function EmptyState({ text = '暂无数据', icon = '▢' }: { text?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-stone-400 dark:text-stone-500">
      <span className="text-3xl opacity-70">{icon}</span>
      <span className="text-sm">{text}</span>
    </div>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  describeCall,
  executeToolCall,
  type ToolCallRecord,
  type ToolExecOutcome,
} from '../../lib/corgiTools';
import { useCorgiChatStore } from '../../stores/corgiChat';

/**
 * 工具确认卡（三态）：
 * - pending：awaiting_confirm 中的写类调用——逐条勾选 + 标题可微调，确认后执行
 * - done：后续 tool 消息齐——展示逐条结果（✓ / － / ✗）
 * - stale：刷新后未确认（pendingCallIds 丢失）——灰化作废
 * 执行走现有 REST API，完成后 invalidate 查询缓存并 resume 对话（流式总结）。
 */
export default function ToolCard({
  calls,
  outcomes,
  state,
}: {
  calls: ToolCallRecord[];
  /** 与 calls 对齐的执行结果（结果态） */
  outcomes: ToolExecOutcome[];
  state: 'pending' | 'done' | 'stale';
}) {
  const resumeWithToolResults = useCorgiChatStore((s) => s.resumeWithToolResults);
  const queryClient = useQueryClient();

  // 勾选与标题微调（挂起态本地态；刷新丢卡本就失效，无需持久化）
  const [checked, setChecked] = useState<boolean[][]>(() =>
    calls.map((c) => describeCall(c)?.items.map(() => true) ?? []),
  );
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  const described = calls.map((c) => describeCall(c));
  const totalItems = described.reduce((n, d) => n + (d?.items.length ?? 0), 0);
  const checkedCount = checked.flat().filter(Boolean).length;

  const invalidate = () => {
    for (const key of ['tasks', 'stats', 'goals', 'schedules', 'inspirations']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const doConfirm = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      const results: ToolExecOutcome[] = [];
      for (let ci = 0; ci < calls.length; ci++) {
        const sel = { selected: [], titleOverrides: {} } as {
          selected: number[];
          titleOverrides: Record<number, string>;
        };
        checked[ci].forEach((on, ii) => {
          if (on) sel.selected.push(ii);
        });
        described[ci]?.items.forEach((_, ii) => {
          const t = titles[`${ci}:${ii}`];
          if (t != null && t.trim()) sel.titleOverrides[ii] = t.trim();
        });
        results.push(await executeToolCall(calls[ci], sel));
      }
      invalidate();
      await resumeWithToolResults(results);
    } finally {
      setExecuting(false);
    }
  };

  const doSkip = async () => {
    if (executing) return;
    await resumeWithToolResults(calls.map((c) => ({ tool: c.name, skipped: true, items: [] })));
  };

  /* ---------- 失效态 ---------- */
  if (state === 'stale') {
    return (
      <div
        data-testid="corgi-tool-card"
        className="rounded-[14px] border border-black/[0.06] bg-white/[0.55] p-3 text-xs text-zinc-400 opacity-60 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-500"
      >
        🔧 未确认 · 已失效（页面刷新），柯基已按"跳过"记录
      </div>
    );
  }

  /* ---------- 结果态 ---------- */
  if (state === 'done') {
    return (
      <div
        data-testid="corgi-tool-card"
        className="overflow-hidden rounded-[14px] border border-black/[0.07] bg-white/[0.85] backdrop-blur-[12px] backdrop-saturate-150 dark:border-white/[0.06] dark:bg-white/[0.055]"
      >
        {outcomes.map((oc, i) => {
          const ok = oc.items.filter((it) => it.status === 'ok').length;
          const fail = oc.items.filter((it) => it.status === 'fail').length;
          const skip = oc.items.filter((it) => it.status === 'skip').length;
          const head = oc.skipped
            ? '◻ 已跳过本次操作'
            : oc.error
              ? `⚠️ 执行失败：${oc.error}`
              : `${ok > 0 ? `✅ 成功 ${ok} 项` : ''}${fail > 0 ? `${ok > 0 ? ' · ' : ''}⚠️ 失败 ${fail} 项` : ''}${skip > 0 ? ` · 跳过 ${skip} 项` : ''}`;
          return (
            <div key={i}>
              {i > 0 && <div className="border-t border-black/[0.06] dark:border-white/[0.05]" />}
              <div className="px-3.5 py-2.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-300">
                {head}
              </div>
              <div className="border-t border-black/[0.06] dark:border-white/[0.05]">
                {oc.items.map((it, j) => (
                  <div key={j} className="flex items-baseline gap-2 px-3.5 py-1.5 text-[13px]">
                    <span
                      className={
                        it.status === 'ok'
                          ? 'shrink-0 text-xs text-emerald-600 dark:text-emerald-400'
                          : it.status === 'fail'
                            ? 'shrink-0 text-xs text-red-500 dark:text-red-400'
                            : 'shrink-0 text-xs text-zinc-400 dark:text-zinc-500'
                      }
                    >
                      {it.status === 'ok' ? '✓' : it.status === 'fail' ? '✗' : '－'}
                    </span>
                    <span
                      className={`min-w-0 flex-1 break-words ${it.status === 'skip' ? 'text-zinc-400 line-through decoration-zinc-400 dark:text-zinc-500' : ''}`}
                    >
                      {it.label}
                    </span>
                    {it.detail && it.status === 'fail' && (
                      <span className="shrink-0 text-[11px] text-red-400 dark:text-red-500">{it.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ---------- 待确认态 ---------- */
  return (
    <div
      data-testid="corgi-tool-card"
      className="overflow-hidden rounded-[14px] border border-black/[0.07] bg-white/[0.85] shadow-[0_1px_2px_rgba(20,12,16,0.04),0_6px_20px_rgba(20,12,16,0.05)] backdrop-blur-[12px] backdrop-saturate-150 dark:border-white/[0.06] dark:bg-white/[0.055] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_6px_20px_rgba(0,0,0,0.3)]"
    >
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold">
        <span>🔧</span>
        <span>
          柯基想帮你
          {calls.length === 1 ? described[0]?.head ?? `执行 ${calls[0].name}` : `执行 ${calls.length} 项操作（共 ${totalItems} 条）`}
        </span>
      </div>
      <div className="border-t border-black/[0.06] dark:border-white/[0.05]">
        {calls.map((_call, ci) => {
          const d = described[ci];
          if (!d) return null;
          return d.items.map((item, ii) => (
            <div
              key={`${ci}:${ii}`}
              className={`flex items-start gap-2.5 px-3.5 py-2 ${ii > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.04]' : ''}`}
            >
              <input
                type="checkbox"
                data-testid={`corgi-tool-check-${ci}-${ii}`}
                checked={checked[ci][ii]}
                disabled={executing}
                onChange={(e) => {
                  setChecked((prev) => prev.map((arr, i) => (i === ci ? arr.map((v, j) => (j === ii ? e.target.checked : v)) : arr)));
                }}
                className="mt-1 h-[15px] w-[15px] shrink-0 cursor-pointer accent-rose-500"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={titles[`${ci}:${ii}`] ?? item.title}
                  disabled={executing}
                  onChange={(e) => setTitles((prev) => ({ ...prev, [`${ci}:${ii}`]: e.target.value }))}
                  className="w-full rounded border-b border-dashed border-transparent bg-transparent px-0.5 py-px text-[13px] text-zinc-800 outline-none transition-colors hover:border-black/[0.12] focus:border-rose-400 focus:bg-black/[0.03] dark:text-zinc-100 dark:hover:border-white/[0.14] dark:focus:bg-white/[0.05]"
                />
                {item.badges.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {item.badges.map((b, bi) => (
                      <span key={bi} className={`rounded-full px-2 py-px ${b.cls}`}>
                        {b.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ));
        })}
      </div>
      <div className="flex justify-end gap-2 border-t border-black/[0.06] px-3.5 py-2.5 dark:border-white/[0.05]">
        {executing ? (
          <span className="py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="animate-pulse">执行中…</span>
          </span>
        ) : (
          <>
            <button
              data-testid="corgi-tool-skip"
              onClick={doSkip}
              className="cursor-pointer rounded-[9px] px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            >
              全部跳过
            </button>
            <button
              data-testid="corgi-tool-confirm"
              onClick={doConfirm}
              disabled={checkedCount === 0}
              className="cursor-pointer rounded-[9px] bg-rose-500 px-3.5 py-1.5 text-xs font-medium text-rose-fg transition-[filter] hover:brightness-105 disabled:cursor-default disabled:opacity-45"
            >
              {checkedCount === totalItems ? '确认执行' : `确认执行 (${checkedCount}/${totalItems})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

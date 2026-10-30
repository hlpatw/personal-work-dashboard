import { useEffect, useRef, useState } from 'react';
import { useCorgiChatStore, type ChatSession } from '../../stores/corgiChat';

/** 会话相对时间展示 */
function relTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}-${dt.getDate()}`;
}

function SessionRow({
  session,
  active,
  onSwitch,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  onSwitch: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSwitch}
      className={`group flex cursor-pointer items-center gap-2 rounded-[9px] px-2.5 py-2 transition-colors ${
        active ? 'bg-rose-500/[0.16]' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
          active ? 'text-rose-600 dark:text-rose-400' : ''
        }`}
      >
        {session.title}
      </span>
      <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{relTime(session.updatedAt)}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`删除会话「${session.title}」？聊天记录将一并删除。`)) onDelete();
        }}
        className="shrink-0 cursor-pointer rounded px-1 py-0.5 text-xs text-zinc-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        title="删除会话"
      >
        🗑
      </button>
    </div>
  );
}

/** 头部会话菜单：柯基 ▾ 弹会话列表（切换/删除/新建），点外部关闭 */
export default function SessionMenu() {
  const { sessions, activeSessionId, newSession, switchSession, deleteSession } = useCorgiChatStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div ref={rootRef} className="relative">
      <button
        data-testid="corgi-session-trigger"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
        title="会话列表"
      >
        <span className="text-lg">🐕</span>
        <span>柯基</span>
        <span
          className={`text-[10px] text-zinc-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          data-testid="corgi-session-menu"
          className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-[14px] border border-black/[0.07] bg-white/[0.94] shadow-[0_2px_6px_rgba(20,12,16,0.08),0_16px_40px_rgba(20,12,16,0.14)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.06] dark:bg-[#14141a]/[0.94] dark:shadow-[0_2px_6px_rgba(0,0,0,0.4),0_16px_40px_rgba(0,0,0,0.5)]"
        >
          <div className="max-h-64 overflow-y-auto p-1.5">
            {sorted.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
                还没有历史会话，和我聊聊吧～
              </p>
            ) : (
              sorted.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onSwitch={() => {
                    switchSession(s.id);
                    setOpen(false);
                  }}
                  onDelete={() => deleteSession(s.id)}
                />
              ))
            )}
          </div>
          <button
            data-testid="corgi-new-session"
            onClick={() => {
              newSession();
              setOpen(false);
            }}
            className="w-full border-t border-black/[0.06] px-3.5 py-2.5 text-left text-[13px] text-rose-600 transition-colors hover:bg-black/[0.05] dark:border-white/[0.05] dark:text-rose-400 dark:hover:bg-white/[0.06]"
          >
            ＋ 新对话
          </button>
        </div>
      )}
    </div>
  );
}

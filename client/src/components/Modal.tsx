import { type ReactNode, useEffect } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Modal({ title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 内容超高时可滚动：max-h 限制在视口内，头部固定、表单体滚动 */}
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl shadow-black/20 ring-1 ring-black/[0.06] dark:bg-[#1b1b20] dark:ring-white/[0.06]">
        <div className="flex shrink-0 items-center justify-between p-5 pb-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 p-5 pt-0">{footer}</div>}
      </div>
    </div>
  );
}

import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

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

  // createPortal：挂到 body，脱离页面流的 transform/animation 包含块
  //（page-fade 的动画含 transform，会让 fixed 弹窗相对它而非视口定位，导致越界/错位）
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 矮内容时垂直居中（m-auto）；超高时贴顶滚动（遮罩 overflow-y-auto）。
          显式 max-h：Tailwind v4 下 max-h-full 在该 flex 结构解析异常。 */}
      <div className="m-auto flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl shadow-black/20 ring-1 ring-black/[0.06] dark:bg-[#1b1b20] dark:ring-white/[0.06]">
        <div className="flex shrink-0 items-center justify-between p-4 pb-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 p-4 pt-0">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

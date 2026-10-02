import type { ReactNode } from 'react';

/** Plane 式卡片：亮度分层，靠表面明度差而非边框区分层级 */
export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl bg-white ring-1 ring-black/[0.05] transition-[box-shadow,transform] duration-150 dark:bg-[#17171b] dark:ring-white/[0.045] ${className}`}
    >
      {children}
    </div>
  );
}

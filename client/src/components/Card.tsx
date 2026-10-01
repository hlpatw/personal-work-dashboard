import type { ReactNode } from 'react';

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-stone-200/70 bg-white/60 shadow-sm shadow-stone-950/[0.04] backdrop-blur-xl transition-[box-shadow,transform] duration-200 dark:border-white/[0.06] dark:bg-stone-900/55 dark:shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

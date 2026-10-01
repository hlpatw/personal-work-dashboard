import type { ReactNode } from 'react';

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-stone-200/80 bg-white shadow-sm shadow-stone-950/[0.03] ring-1 ring-transparent dark:border-stone-800 dark:bg-stone-900 dark:shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

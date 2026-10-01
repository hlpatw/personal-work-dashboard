import type { ReactNode } from 'react';

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-950/[0.03] ring-1 ring-transparent dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

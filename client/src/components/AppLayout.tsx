import { Outlet, useLocation } from 'react-router';
import Sidebar from './Sidebar';

/** 专业风背景：仅顶部一抹极淡的玫瑰光晕 */
function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-56 left-1/2 h-[28rem] w-[46rem] -translate-x-1/2 rounded-full bg-rose-400/[0.07] blur-3xl dark:bg-rose-500/[0.05]" />
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  return (
    <div className="flex h-screen overflow-hidden">
      <AuroraBackground />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <div key={location.pathname} className="page-fade">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

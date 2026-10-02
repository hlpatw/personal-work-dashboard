import { Outlet, useLocation } from 'react-router';
import Sidebar from './Sidebar';

/** 自然光风格的柔和渐变背景（aurora），玻璃卡片的底色来源 */
function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-40 -left-32 h-[26rem] w-[26rem] rounded-full bg-rose-300/50 blur-3xl dark:bg-rose-500/10" />
      <div className="absolute top-1/4 -right-40 h-[30rem] w-[30rem] rounded-full bg-violet-300/40 blur-3xl dark:bg-violet-500/10" />
      <div className="absolute -bottom-48 left-1/3 h-[26rem] w-[26rem] rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-500/[0.06]" />
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

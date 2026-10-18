import { Outlet, useLocation } from 'react-router';
import Sidebar from './Sidebar';
import CorgiSidebar from './corgi/CorgiSidebar';

/** 氛围层背景：纵深渐变 + 左上冷光 + 右上品牌光 + 颗粒（标准档）
 *  光源锚在视口角落——放中间会透过半透明卡片显出"脏斑" */
function AtmosphereBackground() {
  return (
    <div className="atmos pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="atm-depth" />
      <div className="atm-glow-b" />
      <div className="atm-glow-a" />
      <div className="atm-grain" />
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  return (
    <div className="flex h-screen overflow-hidden">
      <AtmosphereBackground />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-7 md:px-[38px] md:py-[30px]">
          <div key={location.pathname} className="page-fade">
            <Outlet />
          </div>
        </div>
      </main>
      <CorgiSidebar />
    </div>
  );
}

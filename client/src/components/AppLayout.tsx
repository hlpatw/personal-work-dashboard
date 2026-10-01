import { Outlet } from 'react-router';
import Sidebar from './Sidebar';

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

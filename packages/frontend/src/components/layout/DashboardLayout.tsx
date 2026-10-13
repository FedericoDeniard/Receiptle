import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Bell, Menu } from "lucide-react";
import { Button } from "../ui/Button";
import logo from "../../logo.svg";
import { DecorativeSquare } from "../ui/DecorativeSquare";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import {
  useNotificationsRealtime,
  useUnreadNotificationsCount,
} from "../../hooks/useNotifications";
import { useTranslation } from "react-i18next";
import { useTour } from "../../hooks/useTour";
import { SidebarContext } from "../../contexts/SidebarContext";

export function DashboardLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { t } = useTranslation();
  const unreadCountQuery = useUnreadNotificationsCount();
  useNotificationsRealtime();
  // Mount the per-route tour watcher — watches location internally
  useTour();

  const unreadCount = unreadCountQuery.data ?? 0;

  const sidebarValue = useMemo(
    () => ({ isOpen: isSidebarOpen }),
    [isSidebarOpen]
  );

  return (
    <SidebarContext.Provider value={sidebarValue}>
      <div className="min-h-dvh bg-[var(--bg-secondary)] flex flex-col lg:flex-row">
        {/* Mobile Header */}
        <header className="lg:hidden bg-[var(--bg-primary)] border-b border-[var(--text-secondary)]/20 p-4 sticky top-0 z-30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative size-8 flex items-center justify-center shrink-0">
              <DecorativeSquare size={32} className="absolute inset-0 m-auto" />
              <img
                src={logo}
                alt="Receiptle Logo"
                className="relative z-10 w-full h-full p-1 object-contain"
              />
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              Receiptle
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsNotificationsOpen(true)}
              className="relative rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              aria-label={t("settings.notifications")}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <Button
              onClick={() => setIsSidebarOpen(true)}
              variant="ghost"
              size="sm"
              icon={<Menu size={24} />}
            />
          </div>
        </header>

        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        <main className="relative flex-1 px-4 py-0 lg:px-8 lg:pt-4 lg:pb-0 lg:ml-64 h-[calc(100dvh-72px)] lg:h-dvh lg:min-h-dvh w-full overflow-x-hidden overflow-y-auto">
          <div className="fixed right-0 top-1/2 z-20 hidden -translate-y-1/2 lg:block">
            <button
              type="button"
              data-tour="notification-bell"
              onClick={() => setIsNotificationsOpen(true)}
              className="group relative flex items-center rounded-l-xl border border-r-0 border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-3 text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)]"
              aria-label={t("settings.notifications")}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -left-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          </div>
          <div className="mx-auto h-[calc(100dvh-73px)] lg:h-[calc(100dvh-16px)] max-w-7xl">
            <Outlet />
          </div>
        </main>
        <NotificationsPanel
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
        />
      </div>
    </SidebarContext.Provider>
  );
}

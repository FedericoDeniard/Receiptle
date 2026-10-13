import { useMemo, useState } from "react";
import { LazyMotion, m, domAnimation, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  Archive,
  Bell,
  CheckCheck,
  Circle,
  Flag,
  Info,
  Trash2,
  VolumeX,
  X,
  MailOpen,
  CheckSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import {
  type NotificationImportance,
  type NotificationItem,
} from "../../services/notifications.service";
import {
  useNotificationActions,
  useNotifications,
} from "../../hooks/useNotifications";

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type PanelFilter = "all" | "unread" | "muted" | "important";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(date: string): string {
  const target = new Date(date).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((target - now) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) return rtf.format(diffSeconds, "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

function getImportanceConfig(importance: NotificationImportance) {
  switch (importance) {
    case "critical":
      return {
        icon: <AlertCircle size={16} />,
        colorClass: "text-red-600",
        bgClass: "bg-red-100",
      };
    case "high":
      return {
        icon: <Flag size={16} />,
        colorClass: "text-amber-600",
        bgClass: "bg-amber-100",
      };
    case "normal":
      return {
        icon: <Info size={16} />,
        colorClass: "text-blue-600",
        bgClass: "bg-blue-100",
      };
    default:
      return {
        icon: <Circle size={16} />,
        colorClass: "text-[var(--text-secondary)]",
        bgClass: "bg-[var(--bg-secondary)]",
      };
  }
}

function NotificationRow({
  item,
  isSelected,
  onSelect,
  onOpen,
}: {
  item: NotificationItem;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const title = t(
    item.title_i18n_key,
    item.i18n_params as Record<string, unknown>
  );
  const body = t(
    item.body_i18n_key,
    item.i18n_params as Record<string, unknown>
  );
  const unread = !item.read_at;
  const importanceConfig = getImportanceConfig(item.importance);

  return (
    <div
      className={`group relative flex items-start gap-3 rounded-xl border p-4 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-200 hover:shadow-md ${
        unread
          ? "border-[var(--button-primary)]/30 bg-[var(--bg-secondary)]"
          : "border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] hover:border-[var(--text-secondary)]/40"
      } ${isSelected ? "ring-2 ring-[var(--button-primary)]/50 border-[var(--button-primary)]/50 bg-[var(--bg-secondary)]" : ""}`}
    >
      {/* Indicador de No Leído (Borde izquierdo) */}
      {unread && (
        <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-md bg-[var(--primary)]" />
      )}

      {/* Checkbox (Aparece en hover o si está seleccionado) */}
      <div
        className={`pt-1 transition-opacity duration-200 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <div className="relative flex items-center justify-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={event => onSelect(event.target.checked)}
            className="peer size-5 cursor-pointer appearance-none rounded border border-[var(--text-secondary)]/30 checked:border-[var(--button-primary)] checked:bg-[var(--button-primary)] hover:border-[var(--button-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--button-primary)]/30 focus:ring-offset-1 transition-[color,background-color,border-color,box-shadow,opacity,transform]"
            aria-label={t("notifications.selectItem")}
          />
          <CheckCheck
            size={14}
            className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100"
            strokeWidth={3}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex-1 text-left min-w-0"
      >
        <div className="flex items-start gap-3">
          {/* Ícono / Avatar */}
          <div
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${importanceConfig.bgClass} ${importanceConfig.colorClass}`}
          >
            {item.avatar_url ? (
              <img
                src={item.avatar_url}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : item.icon_key ? (
              <span className="font-semibold text-sm capitalize">
                {item.icon_key.charAt(0)}
              </span>
            ) : (
              <Bell size={18} />
            )}
          </div>

          {/* Contenido */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`truncate text-sm ${unread ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-primary)]"}`}
              >
                {title}
              </span>
              <span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                {relativeTime(item.created_at)}
              </span>
            </div>

            <p
              className={`mt-1 line-clamp-2 text-sm leading-relaxed break-words ${unread ? "text-[var(--text-primary)] opacity-90" : "text-[var(--text-secondary)]"}`}
            >
              {body}
            </p>

            {/* Metadatos (Importancia, Estado silenciado) */}
            {(item.importance !== "normal" || item.is_muted) && (
              <div className="mt-2 flex items-center gap-3 text-xs font-medium">
                {item.importance !== "normal" && (
                  <span
                    className={`inline-flex items-center gap-1 ${importanceConfig.colorClass}`}
                  >
                    {importanceConfig.icon}
                    {t(`notifications.importance.${item.importance}`)}
                  </span>
                )}
                {item.is_muted && (
                  <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                    <VolumeX size={14} />
                    {t("notifications.state.muted")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

export function NotificationsPanel({
  isOpen,
  onClose,
}: NotificationsPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<PanelFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setSelectedIds([]);
    }
  }

  const notificationsQuery = useNotifications({
    archived: false,
    unread: filter === "unread",
    muted: filter === "muted" ? true : undefined,
    importance: filter === "important" ? "high" : undefined,
    limit: 100,
  });
  const actions = useNotificationActions();

  const isBusy =
    actions.markAsRead.isPending ||
    actions.markAsUnread.isPending ||
    actions.archive.isPending ||
    actions.mute.isPending ||
    actions.setImportance.isPending ||
    actions.remove.isPending;

  const notifications = notificationsQuery.data ?? [];
  const selectedCount = selectedIds.length;
  const allVisibleSelected =
    selectedCount > 0 && selectedCount === notifications.length;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(notifications.map(item => item.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const runAction = async (callback: () => Promise<void>) => {
    if (!selectedIds.length) return;
    await callback();
    clearSelection();
  };

  const openNotification = async (item: NotificationItem) => {
    if (!item.read_at) {
      await actions.markAsRead.mutateAsync({ ids: [item.id] });
    }
    if (item.action_path) {
      navigate(item.action_path);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <LazyMotion features={domAnimation}>
          <>
            {/* Overlay oscuro */}
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={onClose}
              aria-label={t("notifications.closePanel")}
            />

            {/* Panel Lateral */}
            <m.aside
              initial={{ x: "100%", boxShadow: "0 0 0 rgba(0,0,0,0)" }}
              animate={{ x: 0, boxShadow: "-10px 0 40px rgba(0,0,0,0.1)" }}
              exit={{ x: "100%", boxShadow: "0 0 0 rgba(0,0,0,0)" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 z-50 h-dvh w-full max-w-md bg-[var(--bg-primary)] border-l border-[var(--text-secondary)]/20 overflow-hidden"
            >
              <div className="flex h-full flex-col bg-[var(--bg-primary)]">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--button-primary)]/10 text-[var(--button-primary)]">
                      <Bell size={18} />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
                      {t("notifications.title")}
                    </h2>
                  </div>
                  <Button
                    onClick={onClose}
                    variant="ghost"
                    size="sm"
                    icon={<X size={20} />}
                    className="!p-2"
                    aria-label={t("notifications.closePanel")}
                  />
                </div>

                {/* Dynamic Toolbar (Filters or Actions) */}
                <div className="min-h-[60px] border-b border-[var(--text-secondary)]/20 bg-[var(--bg-secondary)]/50 px-4 py-3 flex items-center justify-between">
                  <AnimatePresence mode="wait">
                    {selectedCount > 0 ? (
                      <m.div
                        key="actions"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="flex w-full items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            aria-label={t("notifications.selectAll")}
                            onClick={toggleSelectAll}
                            className="group relative flex size-5 items-center justify-center rounded border-2 border-[var(--button-primary)] bg-[var(--button-primary)] transition-[color,background-color,border-color,box-shadow,opacity,transform]"
                          >
                            <CheckCheck
                              size={14}
                              className="text-white"
                              strokeWidth={3}
                            />
                          </button>
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {selectedCount} seleccionadas
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<MailOpen size={18} />}
                            className="!p-2"
                            title={t("notifications.actions.markRead")}
                            disabled={isBusy}
                            onClick={() =>
                              runAction(() =>
                                actions.markAsRead.mutateAsync({
                                  ids: selectedIds,
                                })
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Archive size={18} />}
                            className="!p-2"
                            title={t("notifications.actions.archive")}
                            disabled={isBusy}
                            onClick={() =>
                              runAction(() =>
                                actions.archive.mutateAsync({
                                  ids: selectedIds,
                                })
                              )
                            }
                          />
                          <div className="h-4 w-px bg-[var(--text-secondary)]/20 mx-1" />
                          <Button
                            variant="danger"
                            size="sm"
                            icon={<Trash2 size={18} />}
                            className="!p-2"
                            title={t("notifications.actions.delete")}
                            disabled={isBusy}
                            onClick={() =>
                              runAction(() =>
                                actions.remove.mutateAsync({ ids: selectedIds })
                              )
                            }
                          />
                        </div>
                      </m.div>
                    ) : (
                      <m.div
                        key="filters"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="flex w-full items-center gap-2"
                      >
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                          {(
                            ["all", "unread", "muted", "important"] as const
                          ).map(value => {
                            const isActive = filter === value;
                            return (
                              <Button
                                key={value}
                                variant={isActive ? "primary" : "secondary"}
                                size="sm"
                                onClick={() => setFilter(value)}
                                className="whitespace-nowrap"
                              >
                                {t(`notifications.filters.${value}`)}
                              </Button>
                            );
                          })}
                        </div>
                        {notifications.length > 0 && (
                          <div className="shrink-0 ml-auto relative flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={toggleSelectAll}
                              className="size-5 cursor-pointer appearance-none rounded border border-[var(--text-secondary)]/30 hover:border-[var(--button-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--button-primary)]/30 focus:ring-offset-1 transition-[color,background-color,border-color,box-shadow,opacity,transform]"
                              aria-label={t("notifications.actions.selectAll")}
                            />
                          </div>
                        )}
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Lista de Notificaciones */}
                <div className="flex-1 overflow-y-auto p-4 bg-[var(--bg-primary)] space-y-2 relative">
                  {notificationsQuery.isLoading ? (
                    <div className="flex h-full flex-col items-center justify-center text-[var(--text-secondary)] opacity-80">
                      <div className="size-8 animate-spin rounded-full border-4 border-[var(--text-secondary)]/20 border-t-[var(--button-primary)] mb-4" />
                      <p className="text-sm font-medium">
                        {t("notifications.loading")}
                      </p>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center -mt-8">
                      <EmptyState
                        icon={CheckSquare}
                        title="Todo al día"
                        description={t("notifications.empty")}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 pb-8">
                      {notifications.map(item => (
                        <NotificationRow
                          key={item.id}
                          item={item}
                          isSelected={selectedSet.has(item.id)}
                          onSelect={checked => {
                            setSelectedIds(current => {
                              if (checked)
                                return [...new Set([...current, item.id])];
                              return current.filter(id => id !== item.id);
                            });
                          }}
                          onOpen={() => openNotification(item)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </m.aside>
          </>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
}

import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  Mail,
  X,
} from "lucide-react";
import { useGmailStatus, useGmailWatches } from "../../hooks/useGmailStatus";
import type {
  GmailConnection,
  GmailStatus,
  GmailWatch,
} from "../../services/gmail.service";
import { Button } from "../ui/Button";

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale);
}

interface GmailPanelProps {
  userId: string | undefined;
  isConnecting: boolean;
  isConnectButtonEnabled: boolean;
  isDisconnecting: string | null;
  onConnect: () => Promise<void>;
  onDisconnect: (connectionId: string, email: string) => void;
  onStartSeed: (connectionId: string, gmailEmail: string) => void;
  userLoading: boolean;
}

interface ConnectionGroups {
  activeConnections: GmailConnection[];
  disconnectedConnections: GmailConnection[];
  connectionsWithoutWatch: GmailConnection[];
  showWebhookWarning: boolean;
}

function deriveConnectionGroups(
  gmailStatus: GmailStatus | undefined,
  gmailWatches: GmailWatch[] | undefined
): ConnectionGroups {
  const connections = gmailStatus?.connections ?? [];
  const activeConnections = connections.filter(
    c => c.status !== "disconnected"
  );
  const disconnectedConnections = connections.filter(
    c => c.status === "disconnected"
  );
  const connectedConnections = activeConnections.filter(
    c => c.status === "connected"
  );
  const watchedEmails = new Set((gmailWatches ?? []).map(w => w.gmail_email));
  const connectionsWithoutWatch = connectedConnections.filter(
    c => !watchedEmails.has(c.gmail_email)
  );
  const showWebhookWarning =
    (gmailStatus?.needsReconnectTotal ?? 0) > 0 ||
    connectionsWithoutWatch.length > 0;

  return {
    activeConnections,
    disconnectedConnections,
    connectionsWithoutWatch,
    showWebhookWarning,
  };
}

function GmailStatusLine({ status }: { status: GmailStatus | undefined }) {
  const { t } = useTranslation();

  if (!status || status.total === 0 || status.activeTotal === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)] mt-1">
        <AlertCircle size={14} />
        {t("settings.notConnected")}
      </span>
    );
  }

  if (status.needsReconnectTotal > 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600 mt-1">
        <AlertCircle size={14} />
        {t("settings.connectedAndReconnectCount", {
          connected: status.connectedTotal,
          reconnect: status.needsReconnectTotal,
        })}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-green-600 mt-1">
      <CheckCircle size={14} />
      {t("settings.connectedCount", { count: status.connectedTotal })}
    </span>
  );
}

function GmailConnectButton({
  isConnecting,
  idleLabelKey,
  disabled,
  variant,
  size,
  iconSize,
  userLoading = false,
  onClick,
}: {
  isConnecting: boolean;
  idleLabelKey: string;
  disabled: boolean;
  variant: "primary" | "secondary";
  size: "sm" | "md";
  iconSize: number;
  userLoading?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const busy = isConnecting || userLoading;

  let label = t(idleLabelKey);
  if (userLoading) {
    label = t("common.loading");
  } else if (isConnecting) {
    label = t("settings.connecting");
  }

  return (
    <Button
      variant={variant}
      size={size}
      icon={
        busy ? (
          <Loader2 className="animate-spin" size={iconSize} />
        ) : (
          <Mail size={iconSize} />
        )
      }
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

function GmailDisconnectButton({
  connection,
  isDisconnecting,
  onDisconnect,
}: {
  connection: GmailConnection;
  isDisconnecting: string | null;
  onDisconnect: (connectionId: string, email: string) => void;
}) {
  const { t } = useTranslation();
  const isBusy = isDisconnecting === connection.id;

  return (
    <Button
      variant="ghost"
      size="sm"
      icon={
        isBusy ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <X size={16} />
        )
      }
      onClick={() => onDisconnect(connection.id, connection.gmail_email)}
      disabled={isBusy}
    >
      {isBusy ? t("settings.disconnecting") : t("settings.disconnect")}
    </Button>
  );
}

function GmailConnectionCard({
  connection,
  locale,
  isConnecting,
  isConnectButtonEnabled,
  isDisconnecting,
  onConnect,
  onDisconnect,
  onStartSeed,
}: {
  connection: GmailConnection;
  locale: string;
  isConnecting: boolean;
  isConnectButtonEnabled: boolean;
  isDisconnecting: string | null;
  onConnect: () => Promise<void>;
  onDisconnect: (connectionId: string, email: string) => void;
  onStartSeed: (connectionId: string, gmailEmail: string) => void;
}) {
  const { t } = useTranslation();
  const isConnected = connection.status === "connected";
  const connectedDate = isConnected
    ? formatDate(connection.connected_at, locale)
    : "";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white rounded-lg border border-zinc-200 gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Mail className="text-zinc-500 shrink-0" size={20} />
        <div className="min-w-0">
          <p className="font-medium text-[var(--text-primary)] truncate">
            {connection.gmail_email}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {isConnected
              ? `${t("settings.connectedAt")} ${connectedDate}`
              : t("settings.needsReconnect")}
          </p>
          {connection.status === "needs_reconnect" && (
            <p className="text-xs text-amber-700 mt-1">
              {t("settings.reconnectHint")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isConnected ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={16} />}
            onClick={() => onStartSeed(connection.id, connection.gmail_email)}
          >
            {t("settings.importEmails") || "Importar"}
          </Button>
        ) : (
          <GmailConnectButton
            isConnecting={isConnecting}
            idleLabelKey="settings.reconnectGmail"
            disabled={!isConnectButtonEnabled}
            variant="secondary"
            size="sm"
            iconSize={16}
            onClick={onConnect}
          />
        )}
        <GmailDisconnectButton
          connection={connection}
          isDisconnecting={isDisconnecting}
          onDisconnect={onDisconnect}
        />
      </div>
    </div>
  );
}

export function GmailPanel({
  userId,
  isConnecting,
  isConnectButtonEnabled,
  isDisconnecting,
  onConnect,
  onDisconnect,
  onStartSeed,
  userLoading,
}: GmailPanelProps) {
  const { t, i18n } = useTranslation();
  const { data: gmailStatus } = useGmailStatus(userId);
  const { data: gmailWatches } = useGmailWatches(userId);

  const {
    activeConnections,
    disconnectedConnections,
    connectionsWithoutWatch,
    showWebhookWarning,
  } = deriveConnectionGroups(gmailStatus, gmailWatches);

  const hasConnections = (gmailStatus?.total ?? 0) > 0;

  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-[var(--primary)]/10 rounded-lg shrink-0">
          <Mail className="text-[var(--primary)]" size={20} />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.emailNotifications")}
          </p>
          <GmailStatusLine status={gmailStatus} />
        </div>
      </div>

      {hasConnections ? (
        <div className="space-y-3">
          {showWebhookWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                <strong>{t("common.note")}:</strong>{" "}
                {t("settings.gmailReconnectWarning")}
              </p>
              {connectionsWithoutWatch.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {t("settings.gmailMissingWatchWarning", {
                    count: connectionsWithoutWatch.length,
                  })}
                </p>
              )}
            </div>
          )}

          {activeConnections.map(connection => (
            <GmailConnectionCard
              key={connection.id}
              connection={connection}
              locale={i18n.language}
              isConnecting={isConnecting}
              isConnectButtonEnabled={isConnectButtonEnabled}
              isDisconnecting={isDisconnecting}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onStartSeed={onStartSeed}
            />
          ))}

          {disconnectedConnections.length > 0 && (
            <div className="pt-3 border-t border-zinc-200 space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t("settings.disconnectedAccountsTitle")}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {t("settings.disconnectedAccountsDescription")}
              </p>
              {disconnectedConnections.map(connection => (
                <div
                  key={connection.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white rounded-lg border border-zinc-200 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Mail className="text-zinc-500 shrink-0" size={20} />
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)] truncate">
                        {connection.gmail_email}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {t("settings.disconnectedNoToken")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end sm:justify-start">
                    <GmailConnectButton
                      isConnecting={isConnecting}
                      idleLabelKey="settings.reconnectGmail"
                      disabled={!isConnectButtonEnabled}
                      variant="secondary"
                      size="sm"
                      iconSize={16}
                      onClick={onConnect}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-zinc-200">
            <GmailConnectButton
              isConnecting={isConnecting}
              userLoading={userLoading}
              idleLabelKey="settings.addAnotherAccount"
              disabled={!isConnectButtonEnabled}
              variant="primary"
              size="md"
              iconSize={20}
              onClick={onConnect}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            {t("settings.connectDescription")}
          </p>
          <GmailConnectButton
            isConnecting={isConnecting}
            userLoading={userLoading}
            idleLabelKey="settings.connectGmail"
            disabled={!isConnectButtonEnabled}
            variant="primary"
            size="md"
            iconSize={20}
            onClick={onConnect}
          />
        </>
      )}

      <p className="mt-4 text-xs text-[var(--text-secondary)]">
        <strong className="text-[var(--primary)]">{t("common.note")}:</strong>{" "}
        {t("settings.gmailPrivacyNote")}
      </p>
    </div>
  );
}

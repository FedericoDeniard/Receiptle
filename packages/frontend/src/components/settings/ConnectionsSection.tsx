import { Suspense, useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useSeedNotifications } from "../../hooks/useSeedNotifications";
import { useInvalidateGmailQueries } from "../../hooks/useGmailStatus";
import { ConfirmModal } from "../ui/ConfirmModal";
import { SeedEmailsModal } from "./SeedEmailsModal";
import { SettingsCategoryCard } from "./SettingsCategoryCard";
import { SettingsSkeleton } from "./SettingsSkeleton";
import { GmailPanel } from "./GmailPanel";
import { gmailService } from "../../services/gmail.service";
import { toast } from "../../utils/toast";
import { getEdgeFunctionErrorMessage } from "../../utils/edge-function-errors";

interface ConnectionsState {
  isConnecting: boolean;
  isDisconnecting: string | null;
  disconnectModal: { isOpen: boolean; connectionId: string; email: string };
  seedModal: { isOpen: boolean; connectionId: string; gmailEmail: string };
}

type ConnectionsAction =
  | { type: "SET_CONNECTING"; isConnecting: boolean }
  | { type: "SET_DISCONNECTING"; connectionId: string | null }
  | {
      type: "OPEN_DISCONNECT_MODAL";
      connectionId: string;
      email: string;
    }
  | { type: "CLOSE_DISCONNECT_MODAL" }
  | {
      type: "OPEN_SEED_MODAL";
      connectionId: string;
      gmailEmail: string;
    }
  | { type: "CLOSE_SEED_MODAL" };

const initialDisconnect = { isOpen: false, connectionId: "", email: "" };
const initialSeed = { isOpen: false, connectionId: "", gmailEmail: "" };
const initialState: ConnectionsState = {
  isConnecting: false,
  isDisconnecting: null,
  disconnectModal: initialDisconnect,
  seedModal: initialSeed,
};

function reducer(state: ConnectionsState, action: ConnectionsAction) {
  switch (action.type) {
    case "SET_CONNECTING":
      return { ...state, isConnecting: action.isConnecting };
    case "SET_DISCONNECTING":
      return { ...state, isDisconnecting: action.connectionId };
    case "OPEN_DISCONNECT_MODAL":
      return {
        ...state,
        disconnectModal: {
          isOpen: true,
          connectionId: action.connectionId,
          email: action.email,
        },
      };
    case "CLOSE_DISCONNECT_MODAL":
      return { ...state, disconnectModal: initialDisconnect };
    case "OPEN_SEED_MODAL":
      return {
        ...state,
        seedModal: {
          isOpen: true,
          connectionId: action.connectionId,
          gmailEmail: action.gmailEmail,
        },
      };
    case "CLOSE_SEED_MODAL":
      return { ...state, seedModal: initialSeed };
  }
}

export function ConnectionsSection() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  useSeedNotifications(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const invalidateGmailQueries = useInvalidateGmailQueries();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { isConnecting, isDisconnecting, disconnectModal, seedModal } = state;

  const successParam = searchParams.get("success");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (successParam === "true") {
      toast.success(t("settings.emailConfiguredSuccess"));
      setSearchParams({});
      gmailService.clearConnectionStatusCache(user?.id);
      invalidateGmailQueries();
    } else if (errorParam === "auth_failed") {
      toast.error(t("settings.emailConfigError"));
      setSearchParams({});
    }
  }, [
    successParam,
    errorParam,
    t,
    user?.id,
    invalidateGmailQueries,
    setSearchParams,
  ]);

  const isConnectButtonEnabled = !loading && !!user?.id && !isConnecting;

  const handleConnectEmail = async () => {
    if (!user?.id) {
      toast.error(t("settings.userIdError"));
      return;
    }
    dispatch({ type: "SET_CONNECTING", isConnecting: true });
    try {
      await gmailService.connectGmail();
    } catch (error) {
      console.error("Error connecting Gmail:", error);
      toast.error(t("settings.gmailConnectError"));
      dispatch({ type: "SET_CONNECTING", isConnecting: false });
    }
  };

  const handleDisconnectEmail = (connectionId: string, email: string) => {
    dispatch({ type: "OPEN_DISCONNECT_MODAL", connectionId, email });
  };

  const confirmDisconnect = async () => {
    const { connectionId } = disconnectModal;
    try {
      dispatch({ type: "SET_DISCONNECTING", connectionId });
      dispatch({ type: "CLOSE_DISCONNECT_MODAL" });
      const result = await gmailService.disconnectGmail(connectionId);
      if (result.success) {
        gmailService.clearConnectionStatusCache(user?.id);
        toast.success(t("settings.gmailDisconnectedSuccess"));
        invalidateGmailQueries();
      } else {
        throw new Error(result.error || "Failed to disconnect");
      }
    } catch (error) {
      console.error("Error disconnecting Gmail:", error);
      toast.error(
        t("settings.gmailDisconnectError"),
        getEdgeFunctionErrorMessage(error, t)
      );
    } finally {
      dispatch({ type: "SET_DISCONNECTING", connectionId: null });
    }
  };

  const handleStartSeed = (connectionId: string, gmailEmail: string) => {
    dispatch({ type: "OPEN_SEED_MODAL", connectionId, gmailEmail });
  };

  return (
    <SettingsCategoryCard
      id="connections"
      titleKey="settingsLayout.nav.connections"
      descriptionKey="settingsLayout.categoryDescription.connections"
      dataTour="settings-gmail"
    >
      <Suspense fallback={<SettingsSkeleton variant="gmail" />}>
        <GmailPanel
          userId={user?.id}
          isConnecting={isConnecting}
          isConnectButtonEnabled={isConnectButtonEnabled}
          isDisconnecting={isDisconnecting}
          onConnect={handleConnectEmail}
          onDisconnect={handleDisconnectEmail}
          onStartSeed={handleStartSeed}
          userLoading={loading}
        />
      </Suspense>

      <ConfirmModal
        isOpen={disconnectModal.isOpen}
        onClose={() => dispatch({ type: "CLOSE_DISCONNECT_MODAL" })}
        onConfirm={confirmDisconnect}
        title={t("settings.disconnectGmail")}
        message={t("settings.confirmDisconnectEmail", {
          email: disconnectModal.email,
        })}
        confirmText={t("settings.disconnect")}
        isDestructive
      />
      <SeedEmailsModal
        isOpen={seedModal.isOpen}
        onClose={() => dispatch({ type: "CLOSE_SEED_MODAL" })}
        connectionId={seedModal.connectionId}
        gmailEmail={seedModal.gmailEmail}
      />
    </SettingsCategoryCard>
  );
}

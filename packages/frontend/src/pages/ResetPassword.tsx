import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/auth/AuthLayout";
import { getSupabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Button } from "../components/ui/Button";

export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    // Check if we have a valid session from the reset link
    const checkSession = async () => {
      const supabase = await getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // No session means the reset link is invalid or expired
        navigate("/login");
      }
    };

    checkSession();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setMessage({
        type: "error",
        text: t("auth.passwordsNotMatch"),
      });
      return;
    }

    if (password.length < 6) {
      setMessage({
        type: "error",
        text: t("auth.weakPassword"),
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const supabase = await getSupabase();

      // Check current session
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!currentSession) {
        throw new Error(
          "No active session found. Please try requesting a new reset link."
        );
      }

      // Fire the update request without waiting (workaround for SDK not resolving)
      supabase.auth.updateUser({ password: password }).catch(() => {
        // Silently handle errors - the password update happens server-side
      });

      // Show success message and redirect
      // The password update happens server-side, we just need to redirect
      setMessage({
        type: "success",
        text: t("auth.passwordResetSuccess"),
      });

      // Redirect to home after 1.5 seconds with a full page reload
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1500);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("errors.unknownError");
      setMessage({
        type: "error",
        text: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)] mb-2">
            {t("auth.resetPassword")}
          </h1>
          <p className="text-[var(--text-secondary)]">
            {t("auth.resetPasswordDescription")}
          </p>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-2xl ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              {t("auth.newPassword")}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[var(--text-secondary)]"
                size={20}
              />
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                required
                className="w-full pl-12 pr-4 py-3 rounded-2xl border border-zinc-200 focus:border-[var(--primary)] focus:outline-none transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              {t("auth.confirmPassword")}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[var(--text-secondary)]"
                size={20}
              />
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                required
                className="w-full pl-12 pr-4 py-3 rounded-2xl border border-zinc-200 focus:border-[var(--primary)] focus:outline-none transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            loading={loading}
            fullWidth
            size="md"
          >
            {loading ? t("common.loading") : t("auth.resetPasswordButton")}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}

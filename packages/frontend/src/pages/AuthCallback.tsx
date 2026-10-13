import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";
import { useTranslation } from "react-i18next";

export function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const supabase = await getSupabase();

        // Supabase automatically handles the OAuth callback and sets the session
        // We just need to check if the session was established
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Error during OAuth callback:", error);
          navigate("/login?error=auth_failed");
          return;
        }

        if (session) {
          // Successfully authenticated, redirect to home
          navigate("/dashboard", { replace: true });
        } else {
          // No session, redirect to login
          navigate("/login");
        }
      } catch (error) {
        console.error("Error handling OAuth callback:", error);
        navigate("/login?error=auth_failed");
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex flex-col items-center justify-center text-center">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-[var(--text-secondary)]">
          {t("auth.completingAuth")}
        </p>
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";
import { DecorativeSquare } from "../components/ui/DecorativeSquare";
import { Button } from "../components/ui/Button";
import { useTranslation } from "react-i18next";

export function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-dvh">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="relative size-32 mx-auto mb-6">
            <DecorativeSquare size={128} className="absolute inset-0" />
            <div className="relative z-10 flex items-center justify-center w-full h-full">
              <span className="text-5xl font-bold text-[var(--primary)]">
                404
              </span>
            </div>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--text-primary)] mb-4">
            {t("errors.pageNotFound")}
          </h1>
          <p className="text-[var(--text-secondary)] mb-8">
            {t("errors.pageNotFoundDescription")}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <Button
            variant="secondary"
            icon={<ArrowLeft size={20} />}
            iconPosition="left"
            onClick={() => navigate(-1)}
          >
            {t("common.back")}
          </Button>

          <Button
            icon={<Home size={20} />}
            iconPosition="left"
            onClick={() => navigate("/dashboard")}
          >
            {t("errors.goHome")}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PricingCardData } from "../../services/pricing";

interface PricingCardProps {
  data: PricingCardData;
  isCurrent: boolean;
  isLoading: boolean;
  /** localized "access until <date>" label for a pending cancellation. */
  accessUntilLabel: string | null;
  onSelect: (key: string) => void;
}

// Intl.NumberFormat construction is expensive (locale data lookup).
// cache one formatter per currency at module load so repeated renders
// reuse the same instance.
const currencyFormatters = new Map<string, Intl.NumberFormat>();
function formatPrice(amount: number, currency: string): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

// single pricing card. themed to match the rest of the app (light
// backgrounds via css vars). renders:
//   - tier name
//   - price + period
//   - per-label ("Per editor")
//   - access-until label (pending cancellation only)
//   - divider
//   - CTA button
//   - feature list with check icons
//
// the highlighted tier gets a thicker border and a filled primary CTA;
// the others get an outline CTA. when isCurrent is true the CTA is
// disabled and shows the "current" label.
function PricingCard({
  data,
  isCurrent,
  isLoading,
  accessUntilLabel,
  onSelect,
}: PricingCardProps) {
  const { t } = useTranslation();

  const ctaLabel = isCurrent
    ? t("accountBilling.pricing.currentPlan")
    : t("accountBilling.pricing.getStarted");

  const ctaDisabled = isCurrent || isLoading || data.source === "free";

  return (
    <div
      className={[
        "rounded-2xl border p-6 flex flex-col bg-[var(--bg-primary)] shadow-sm",
        data.highlight
          ? "border-[var(--primary)] ring-1 ring-[var(--primary)]/30"
          : "border-[var(--text-secondary)]/20",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">
          {data.displayName}
        </h3>
        {isCurrent && (
          <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20">
            {t("accountBilling.pricing.currentBadge")}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-bold text-[var(--text-primary)]">
          {formatPrice(data.pricePerMonth, data.currency)}
        </span>
        <span className="text-sm text-[var(--text-secondary)]">
          {t("accountBilling.pricing.perMonth")}
        </span>
      </div>

      {accessUntilLabel && (
        <p className="mt-2 inline-flex w-fit rounded-full bg-[var(--primary)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
          {accessUntilLabel}
        </p>
      )}

      {data.features.length > 0 && (
        <div className="my-5 h-px bg-[var(--text-secondary)]/15" />
      )}

      {data.source !== "free" && (
        <button
          type="button"
          onClick={() => onSelect(data.key)}
          disabled={ctaDisabled}
          className={[
            "w-full rounded-md py-2 text-sm font-medium transition-colors",
            data.highlight
              ? ctaDisabled
                ? "bg-[var(--primary)]/40 text-white cursor-default"
                : "bg-[var(--primary)] text-white hover:opacity-90"
              : ctaDisabled
                ? "bg-[var(--text-secondary)]/10 text-[var(--text-secondary)] cursor-default"
                : "bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--text-secondary)]/30 hover:border-[var(--primary)] hover:text-[var(--primary)]",
          ].join(" ")}
        >
          {isLoading && !isCurrent
            ? t("accountBilling.pricing.processing")
            : ctaLabel}
        </button>
      )}

      {data.features.length > 0 && (
        <ul className="mt-6 space-y-3 text-sm flex-1">
          {data.features.map(featureKey => (
            <li key={featureKey} className="flex items-start gap-2.5">
              <Check
                size={16}
                className="text-[var(--primary)] mt-0.5 shrink-0"
                strokeWidth={3}
              />
              <span className="text-[var(--text-primary)]">
                {t(featureKey)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { PricingCard };

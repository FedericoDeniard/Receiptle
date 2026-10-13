import { useState } from "react";
import { CalendarClock, Mail, Repeat, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatDate } from "../../hooks/useFormatDate";
import type { SubscriptionCandidate } from "../../services/transactions.service";
import { formatCurrency } from "../../utils/currency";
import { getSubscriptionStatus } from "./subscriptionStatus";
import { LazyMotion, m, domAnimation } from "framer-motion";
import { SubscriptionTransactionsList } from "./SubscriptionTransactionsList";

interface SubscriptionListItemProps {
  candidate: SubscriptionCandidate;
}

function getStatusClass(status: "active" | "inactive" | "unknown"): string {
  if (status === "active") return "bg-emerald-100 text-emerald-700";
  if (status === "inactive") return "bg-rose-100 text-rose-700";
  return "bg-zinc-100 text-zinc-700";
}

export function SubscriptionListItem({ candidate }: SubscriptionListItemProps) {
  const { t } = useTranslation();
  const { formatShortDate } = useFormatDate();
  const [isExpanded, setIsExpanded] = useState(false);

  const confidence = Math.min(
    100,
    Math.max(0, Math.round(candidate.confidence_score))
  );
  const status = getSubscriptionStatus(candidate.next_estimated_date);
  const shouldShowYearForYearly = candidate.frequency === "yearly";

  const displayName =
    candidate.merchant_display || candidate.merchant_normalized;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <LazyMotion features={domAnimation}>
      <article className="flex flex-col rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] shadow-sm hover:border-[var(--text-secondary)]/40 hover:bg-[var(--bg-secondary)]/20 transition-[color,background-color,border-color,box-shadow,opacity,transform]">
        <button
          type="button"
          className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 cursor-pointer w-full text-left appearance-none bg-transparent"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Avatar / Icon */}
          <div className="flex size-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-bold text-sm sm:text-lg">
            {initial}
          </div>

          {/* Main Content (Left) */}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 sm:gap-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                {displayName}
              </h2>
              {/* Status badge visible inline only on desktop */}
              <span
                className={`hidden sm:inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusClass(status)}`}
              >
                {t(`subscriptions.status.${status}`)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1 font-medium bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded-md">
                {candidate.occurrences}{" "}
                {t("subscriptions.occurrences").toLowerCase()}
              </span>
              <span className="flex items-center gap-1">
                <Repeat size={12} className="shrink-0" />
                {t(`subscriptions.frequency.${candidate.frequency}`)}
              </span>
              <span className="hidden sm:inline opacity-40">•</span>
              <span className="flex items-center gap-1">
                <CalendarClock size={12} className="shrink-0" />
                <span className="hidden sm:inline">
                  {t("subscriptions.nextDate")}:
                </span>
                <span className="sm:hidden">{t("common.next", "Next")}:</span>{" "}
                {candidate.next_estimated_date
                  ? formatShortDate(
                      candidate.next_estimated_date,
                      shouldShowYearForYearly
                    )
                  : t("errors.unknownError")}
              </span>
              <span className="hidden md:inline opacity-40">•</span>
              <span className="hidden md:flex items-center gap-1">
                <Mail size={12} className="shrink-0" />
                {candidate.source_email_consistent
                  ? t("subscriptions.consistent")
                  : t("subscriptions.variable")}
              </span>
            </div>
          </div>

          {/* Right Side (Amount & secondary info) */}
          <div className="flex shrink-0 flex-col items-end justify-center gap-1 pl-2 text-right">
            <p className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
              {formatCurrency(candidate.avg_amount, candidate.currency)}
              <span className="ml-1 text-xs font-normal text-[var(--text-secondary)]">
                {candidate.currency}
              </span>
            </p>

            <div className="flex items-center gap-2">
              {/* Status badge on mobile */}
              <span
                className={`sm:hidden rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusClass(status)}`}
              >
                {t(`subscriptions.status.${status}`)}
              </span>

              {/* Confidence on desktop */}
              <span className="hidden sm:inline-block text-[10px] sm:text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full">
                {t("subscriptions.confidence", { value: confidence })}
              </span>

              <ChevronDown
                size={18}
                className={`text-[var(--text-secondary)] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
              />
            </div>
          </div>
        </button>

        {/* Expanded Accordion Area — animates via grid-template-rows
            so the browser does not retrigger layout each frame. */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            isExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t-0 -mt-2">
              <SubscriptionTransactionsList
                merchantNormalized={candidate.merchant_normalized}
                currency={candidate.currency}
              />
            </div>
          </div>
        </div>
      </article>
    </LazyMotion>
  );
}

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, CircleAlert, Loader2, XIcon } from "lucide-react";
import type { ToolUIPart } from "ai";
import { Button } from "@/components/ui/Button";

type ToolPart = ToolUIPart;

const TOOL_DENIED_RESULT = "Tool call was not approved by the user";

const ROW_SHELL =
  "my-3 flex w-full max-w-md items-center gap-3 rounded-xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-4";

function isExecutionDeniedOutput(output: unknown): boolean {
  if (typeof output === "string") {
    return output === TOOL_DENIED_RESULT;
  }
  if (output && typeof output === "object" && "type" in output) {
    return (output as { type: unknown }).type === "execution-denied";
  }
  return false;
}

interface ToolApprovalCardProps {
  part: ToolPart;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  /** i18n prefix, e.g. "assistant.deleteTransaction". The card looks up:
   *  .title_one/.title_other, .subtitle_one/.subtitle_other,
   *  .processing_one/.processing_other, .canceling_one/.canceling_other,
   *  .approved_one/.approved_other, .rejected_one/.rejected_other, .error
   */
  i18nPrefix: string;
  /** Content shown inside the approval-requested card (above buttons) */
  children?: ReactNode;
  /** Count for pluralization (default 1) */
  count?: number;
  /** Optional summary for success/denied cards (e.g. "Starbucks, Netflix") */
  summary?: string;
  /** Confirm button variant (default "primary"). Use "danger" for destructive actions. */
  confirmVariant?: "primary" | "danger";
  /** Confirm button icon (default CheckIcon). Use Trash2 for delete. */
  confirmIcon?: ReactNode;
  /** When true, the approval-requested card hides the Confirm button and
   *  renders only Cancel. Use when pre-validation already determined the
   *  action would be a no-op (e.g. target row no longer exists). Cancel
   *  still calls onReject so the AI SDK transitions the part out of
   *  approval-requested and the agent's paused run resumes. */
  disableApprovalActions?: boolean;
}

interface ApprovalRequestCardProps {
  approvalId: string;
  i18nPrefix: string;
  count: number;
  confirmVariant: "primary" | "danger";
  confirmIcon: ReactNode;
  disableApprovalActions: boolean;
  onApprove: () => void;
  onReject: () => void;
  children?: ReactNode;
}

function ApprovalRequestCard({
  approvalId,
  i18nPrefix,
  count,
  confirmVariant,
  confirmIcon,
  disableApprovalActions,
  onApprove,
  onReject,
  children,
}: ApprovalRequestCardProps) {
  const { t } = useTranslation();

  return (
    <article
      className="my-3 max-w-md rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] p-5 shadow-sm"
      aria-label={t(`${i18nPrefix}.title`, { count })}
    >
      <h3 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">
        {t(`${i18nPrefix}.title`, { count })}
      </h3>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        {t(`${i18nPrefix}.subtitle`, { count })}
      </p>

      {children}

      <footer className="mt-5 flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<XIcon size={16} />}
          onClick={onReject}
        >
          {t("common.cancel")}
        </Button>
        {!disableApprovalActions && (
          <Button
            variant={confirmVariant}
            size="sm"
            icon={confirmIcon ?? <CheckIcon size={16} />}
            onClick={onApprove}
          >
            {t("common.confirm")}
          </Button>
        )}
      </footer>
    </article>
  );
}

function ToolProcessingRow({
  i18nPrefix,
  count,
  wasApproved,
}: {
  i18nPrefix: string;
  count: number;
  wasApproved: boolean;
}) {
  const { t } = useTranslation();
  const processingKey = wasApproved
    ? `${i18nPrefix}.processing`
    : `${i18nPrefix}.canceling`;

  return (
    <div className={ROW_SHELL} aria-label={t(processingKey, { count })}>
      <Loader2
        className={`size-4 shrink-0 animate-spin ${
          wasApproved ? "text-[var(--text-secondary)]" : "text-rose-600"
        }`}
      />
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {t(processingKey, { count })}
      </span>
    </div>
  );
}

function ToolResultRow({
  ariaLabel,
  icon,
  iconShellClassName,
  title,
  summary,
  summaryClassName,
}: {
  ariaLabel: string;
  icon: ReactNode;
  iconShellClassName: string;
  title: string;
  summary?: string;
  summaryClassName: string;
}) {
  return (
    <div className={ROW_SHELL} aria-label={ariaLabel}>
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconShellClassName}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </p>
        {summary && (
          <p
            className={`text-xs text-[var(--text-secondary)] ${summaryClassName}`}
          >
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}

export function ToolApprovalCard({
  part,
  onApprove,
  onReject,
  i18nPrefix,
  children,
  count = 1,
  summary,
  confirmVariant = "primary",
  confirmIcon,
  disableApprovalActions = false,
}: ToolApprovalCardProps) {
  const { t } = useTranslation();

  if (part.state === "input-streaming" || part.state === "input-available") {
    return null;
  }

  if (part.state === "approval-requested") {
    return (
      <ApprovalRequestCard
        approvalId={part.approval.id}
        i18nPrefix={i18nPrefix}
        count={count}
        confirmVariant={confirmVariant}
        confirmIcon={confirmIcon}
        disableApprovalActions={disableApprovalActions}
        onApprove={() => onApprove(part.approval.id)}
        onReject={() => onReject(part.approval.id)}
      >
        {children}
      </ApprovalRequestCard>
    );
  }

  if (part.state === "approval-responded") {
    return (
      <ToolProcessingRow
        i18nPrefix={i18nPrefix}
        count={count}
        wasApproved={part.approval.approved !== false}
      />
    );
  }

  const isDenied =
    part.state === "output-denied" ||
    (part.state === "output-available" && isExecutionDeniedOutput(part.output));

  if (isDenied) {
    return (
      <ToolResultRow
        ariaLabel={t(`${i18nPrefix}.rejected`, { count })}
        icon={<XIcon className="size-4" />}
        iconShellClassName="bg-rose-100 text-rose-700"
        title={t(`${i18nPrefix}.rejected`, { count })}
        summary={summary}
        summaryClassName="truncate"
      />
    );
  }

  if (part.state === "output-error") {
    return (
      <ToolResultRow
        ariaLabel={t(`${i18nPrefix}.error`)}
        icon={<CircleAlert className="size-4" />}
        iconShellClassName="bg-red-100 text-red-700"
        title={t(`${i18nPrefix}.error`)}
        summary={part.errorText}
        summaryClassName="truncate"
      />
    );
  }

  return (
    <ToolResultRow
      ariaLabel={t(`${i18nPrefix}.approved`, { count })}
      icon={<CheckIcon className="size-4" />}
      iconShellClassName="bg-emerald-100 text-emerald-700"
      title={t(`${i18nPrefix}.approved`, { count })}
      summary={summary}
      summaryClassName="line-clamp-2"
    />
  );
}

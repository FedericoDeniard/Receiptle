import type { UIMessage } from "ai";

import {
  Attachment,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import { MessageResponse } from "@/components/ai-elements/message";
import { AttachmentLightbox } from "./AttachmentLightbox";
import { ToolPill } from "./ToolPill";
import { CreateTransactionConfirmation } from "./CreateTransactionConfirmation";
import { DeleteTransactionConfirmation } from "./DeleteTransactionConfirmation";
import { UpdateTransactionConfirmation } from "./UpdateTransactionConfirmation";
import { type ReactNode, useCallback, useState } from "react";

type ToolPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}` | "dynamic-tool" }
>;

type FilePart = Extract<UIMessage["parts"][number], { type: "file" }>;

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/**
 * Tools that require user approval and render a dedicated confirmation
 * card. These render outside the per-tool status line so the Approve/Reject
 * buttons stay visible.
 */
const APPROVAL_TOOL_TYPES = new Set([
  "tool-createTransactionTool",
  "tool-deleteTransactionTool",
  "tool-updateTransactionTool",
]);

function isApprovalTool(
  part: UIMessage["parts"][number],
  hasApproval: boolean
): boolean {
  return hasApproval && APPROVAL_TOOL_TYPES.has(part.type);
}

function isRegularToolPart(
  part: UIMessage["parts"][number],
  hasApproval: boolean
): part is ToolPart {
  if (!isToolPart(part)) return false;
  if (isApprovalTool(part, hasApproval)) return false;
  return true;
}

/**
 * The @mastra/ai-sdk adapter converts the server-side `tripwire` chunk to a
 * `data-tripwire` data part; the AI SDK silently persists it unless we render
 * it explicitly. Returns the `reason` string so the UI can show why the
 * request was blocked instead of an empty bubble.
 */
function getTripwireReason(
  part: UIMessage["parts"][number],
  isUser: boolean
): string | null {
  if (isUser) return null;
  if (part.type !== "data-tripwire") return null;
  const data = (part as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const reason = (data as { reason?: unknown }).reason;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;
  return reason;
}

function FileMessagePart({
  part,
  lightboxOpen,
  onOpenChange,
}: {
  part: FilePart;
  lightboxOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isImage =
    typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
  const openLightbox = () => {
    if (!isImage) return;
    onOpenChange(true);
  };

  return (
    <div className="mb-2 [button]:hidden">
      <Attachments variant="grid">
        <Attachment
          data={{ ...part, id: part.url } as never}
          {...(isImage
            ? {
                className: "cursor-zoom-in transition-opacity hover:opacity-90",
                onClick: openLightbox,
                onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openLightbox();
                  }
                },
                role: "button",
                tabIndex: 0,
              }
            : {})}
        >
          <AttachmentPreview />
        </Attachment>
      </Attachments>
      {isImage && (
        <AttachmentLightbox
          alt={part.filename ?? "Attached image"}
          open={lightboxOpen}
          src={part.url}
          onOpenChange={onOpenChange}
        />
      )}
    </div>
  );
}

function ToolMessagePart({
  part,
  hasApproval,
  onApproveTool,
  onRejectTool,
}: {
  part: ToolPart;
  hasApproval: boolean;
  onApproveTool?: (id: string) => void;
  onRejectTool?: (id: string) => void;
}) {
  if (part.errorText) {
    console.error(`[tool:${part.toolName ?? part.type}]`, part.errorText);
  }

  if (isRegularToolPart(part, hasApproval)) {
    return <ToolPill part={part} />;
  }

  if (part.type === "tool-deleteTransactionTool") {
    return (
      <DeleteTransactionConfirmation
        part={
          part as unknown as Parameters<
            typeof DeleteTransactionConfirmation
          >[0]["part"]
        }
        onApprove={onApproveTool}
        onReject={onRejectTool}
      />
    );
  }

  if (part.type === "tool-updateTransactionTool") {
    return (
      <UpdateTransactionConfirmation
        part={
          part as unknown as Parameters<
            typeof UpdateTransactionConfirmation
          >[0]["part"]
        }
        onApprove={onApproveTool}
        onReject={onRejectTool}
      />
    );
  }

  return (
    <CreateTransactionConfirmation
      part={
        part as unknown as Parameters<
          typeof CreateTransactionConfirmation
        >[0]["part"]
      }
      onApprove={onApproveTool}
      onReject={onRejectTool}
    />
  );
}

export type MessagePartsProps = {
  parts: UIMessage["parts"];
  isUser: boolean;
  onApproveTool?: (id: string) => void;
  onRejectTool?: (id: string) => void;
};

export function MessageParts({
  parts,
  isUser,
  onApproveTool,
  onRejectTool,
}: MessagePartsProps) {
  const hasApproval = Boolean(onApproveTool && onRejectTool);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const elements: ReactNode[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      elements.push(
        <MessageResponse key={`text-${elements.length}`}>
          {part.text}
        </MessageResponse>
      );
      continue;
    }

    if (part.type === "file" && isUser) {
      elements.push(
        <FileMessagePart
          key={`file-${part.url}`}
          part={part}
          lightboxOpen={lightbox?.src === part.url}
          onOpenChange={open => {
            if (open) {
              setLightbox({
                src: part.url,
                alt: part.filename ?? "Attached image",
              });
            } else {
              closeLightbox();
            }
          }}
        />
      );
      continue;
    }

    if (isToolPart(part)) {
      elements.push(
        <ToolMessagePart
          key={`${part.type}-${part.toolCallId}-${elements.length}`}
          part={part}
          hasApproval={hasApproval}
          onApproveTool={onApproveTool}
          onRejectTool={onRejectTool}
        />
      );
      continue;
    }

    const tripwireReason = getTripwireReason(part, isUser);
    if (tripwireReason) {
      elements.push(
        <MessageResponse key={`tripwire-${elements.length}`}>
          {tripwireReason}
        </MessageResponse>
      );
    }
  }

  return <>{elements}</>;
}

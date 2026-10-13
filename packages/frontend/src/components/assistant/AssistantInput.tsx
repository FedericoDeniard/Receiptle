import { useRef } from "react";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "../ai-elements/prompt-input";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
} from "../ai-elements/attachments";
import { TooltipProvider } from "../ui/shadcn/tooltip";
import { Spinner } from "../ui/shadcn/spinner";
import { useUploadChatAttachments } from "../../hooks/useChatAttachments";
import type { ChatAttachment } from "../../services/chat-attachments.service";
import { HistoryToggleButton } from "./HistoryToggleButton";
import type { ChatStatus } from "ai";

export interface AssistantInputHandle {
  threadId: string;
  text: string;
  files: Array<{
    type: "file";
    mediaType: string;
    filename: string;
    url: string;
  }>;
}

interface AssistantInputProps {
  resolveThreadId: () => string;
  onSend: (payload: AssistantInputHandle) => void;
  onAttachmentsUploaded?: (attachments: ChatAttachment[]) => void;
  status?: ChatStatus;
  stop?: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  placeholder: string;
}

/**
 * Public component. Wraps the body in the context providers so consumers
 * don't need to know which providers `usePromptInputAttachments` depends
 * on. The body is split out because React context requires the provider
 * to be an ancestor of the consumer hook — putting the provider inside
 * the same component that calls the hook throws at render.
 */
export function AssistantInput(props: AssistantInputProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <PromptInputProvider>
        <AssistantInputBody {...props} />
      </PromptInputProvider>
    </TooltipProvider>
  );
}

function AssistantInputBody({
  resolveThreadId,
  onSend,
  onAttachmentsUploaded,
  status = "ready",
  stop,
  showHistory,
  onToggleHistory,
  placeholder,
}: AssistantInputProps) {
  const {
    files: promptFiles,
    clear: clearPromptFiles,
    remove: removePromptFile,
  } = usePromptInputAttachments();
  const uploadAttachments = useUploadChatAttachments();
  // Re-entrance guard: the async attachment upload runs outside of useChat's
  // status (status stays "ready" until sendMessage is called), so the submit
  // button stays clickable during the upload. Without this, a double-click or
  // a second Enter triggers a second handleSubmit, causing duplicate uploads
  // (extra rows in chat_attachments + storage) and duplicate user messages.
  const isSubmittingRef = useRef(false);
  const isUploading = uploadAttachments.isPending;

  return (
    <PromptInput
      accept="image/*"
      onSubmit={async message => {
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        try {
          if (status !== "ready") {
            throw new Error("Chat is busy");
          }
          const trimmed = message.text.trim();
          if (!trimmed && promptFiles.length === 0) return;

          const threadId = resolveThreadId();
          let uploaded: ChatAttachment[] = [];
          if (promptFiles.length > 0) {
            const filesToUpload = await Promise.all(
              promptFiles.map(async f => {
                const response = await fetch(f.url);
                if (!response.ok) {
                  throw new Error(
                    `Failed to fetch attachment: ${response.status} ${response.statusText}`
                  );
                }
                const blob = await response.blob();
                return new File([blob], f.filename ?? "file", {
                  type: f.mediaType ?? blob.type,
                });
              })
            );
            try {
              uploaded = await uploadAttachments.mutateAsync({
                threadId,
                files: filesToUpload,
              });
              onAttachmentsUploaded?.(uploaded);
            } catch (err) {
              console.error("[Assistant] attachment upload failed", err);
              return;
            }
          }

          const files = uploaded.map(a => ({
            type: "file" as const,
            mediaType: a.mime_type,
            filename: a.filename,
            url: a.signedUrl,
          }));

          onSend({ threadId, text: trimmed, files });
          clearPromptFiles();
        } finally {
          isSubmittingRef.current = false;
        }
      }}
      className="shrink-0 overflow-hidden rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] shadow-sm [&_[data-slot=input-group]]:!border-0"
    >
      <PromptInputBody>
        {promptFiles.length > 0 && (
          <div
            data-align="block-start"
            className="order-first flex w-full flex-wrap items-end justify-start gap-2 px-3 pt-3"
          >
            {promptFiles.map(file => (
              <Attachment
                key={file.id}
                data={file}
                onRemove={() => {
                  if (!isUploading) removePromptFile(file.id);
                }}
                className="bg-blue-500/10"
              >
                <AttachmentPreview />
                <AttachmentRemove
                  disabled={isUploading}
                  className="bg-[var(--accent)] text-[var(--text-primary)] hover:bg-[var(--accent)]/80"
                />
              </Attachment>
            ))}
          </div>
        )}
        <PromptInputTextarea
          disabled={isUploading}
          placeholder={placeholder}
          className="text-base"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger
              disabled={isUploading}
              className="bg-white"
            />
            <PromptInputActionMenuContent style={{ backgroundColor: "#fff" }}>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <HistoryToggleButton show={showHistory} onToggle={onToggleHistory} />
        </PromptInputTools>
        <PromptInputSubmit disabled={isUploading} status={status} onStop={stop}>
          {isUploading ? <Spinner /> : undefined}
        </PromptInputSubmit>
      </PromptInputFooter>
    </PromptInput>
  );
}

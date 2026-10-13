import { useCallback, useReducer } from "react";
import {
  X,
  Upload,
  File,
  AlertCircle,
  CheckCircle,
  Loader,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { uploadDocumentForAnalysis } from "../../services/document-upload.service";
import { getEdgeFunctionErrorMessage } from "../../utils/edge-function-errors";
import { queryKeys } from "../../lib/query-client";
import {
  useClipboardFile,
  type ClipboardReadError,
} from "../../hooks/useClipboardFile";

function getFileIcon(file: File) {
  if (file.type === "application/pdf") {
    return <File className="size-8 text-red-500" />;
  }
  return <File className="size-8 text-blue-500" />;
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

type TransactionFormData = {
  transaction_type: "income" | "expense";
  merchant: string;
  amount: string;
  currency: string;
  category: string;
  transaction_date: string;
};

interface UploadTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (transactionId: string) => void;
  onError: (error: string) => void;
}

// File validation constants (matching existing infrastructure)
const MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB
const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5MB
const SUPPORTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/webp",
  "application/pdf",
];

type UploadState = "idle" | "uploading" | "processing" | "success" | "error";

const MAX_CLARIFICATIONS_LENGTH = 250;

interface UploadFormState {
  selectedFile: File | null;
  dragActive: boolean;
  errorMessage: string;
  uploadState: UploadState;
  pasteSuccessMessage: string;
  userClarifications: string;
}

type UploadFormAction =
  | { type: "FILE_SELECTED"; file: File; pasteMessage: string }
  | { type: "DRAG_ACTIVE"; active: boolean }
  | { type: "SET_UPLOAD_STATE"; state: UploadState }
  | { type: "SET_ERROR"; message: string }
  | { type: "CLEAR_SELECTED_FILE" }
  | { type: "SET_CLARIFICATIONS"; value: string }
  | { type: "RESET" };

function uploadFormReducer(
  state: UploadFormState,
  action: UploadFormAction
): UploadFormState {
  switch (action.type) {
    case "FILE_SELECTED":
      return {
        ...state,
        selectedFile: action.file,
        errorMessage: "",
        uploadState: "idle",
        pasteSuccessMessage: action.pasteMessage,
      };
    case "DRAG_ACTIVE":
      return { ...state, dragActive: action.active };
    case "SET_UPLOAD_STATE":
      return { ...state, uploadState: action.state };
    case "SET_ERROR":
      return {
        ...state,
        errorMessage: action.message,
        uploadState: "error",
        pasteSuccessMessage: "",
      };
    case "CLEAR_SELECTED_FILE":
      return { ...state, selectedFile: null, pasteSuccessMessage: "" };
    case "SET_CLARIFICATIONS":
      return {
        ...state,
        userClarifications: action.value.slice(0, MAX_CLARIFICATIONS_LENGTH),
      };
    case "RESET":
      return initialState;
  }
}

const initialState: UploadFormState = {
  selectedFile: null,
  dragActive: false,
  errorMessage: "",
  uploadState: "idle",
  pasteSuccessMessage: "",
  userClarifications: "",
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function DropZone({
  dragActive,
  isProcessing,
  onDrag,
  onDrop,
  onFileSelect,
  onPaste,
}: {
  dragActive: boolean;
  isProcessing: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
  onPaste: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
        dragActive
          ? "border-[var(--primary)] bg-[var(--primary)]/5"
          : "border-zinc-300 hover:border-[var(--primary)]"
      }`}
      onDragEnter={onDrag}
      onDragLeave={onDrag}
      onDragOver={onDrag}
      onDrop={onDrop}
    >
      <Upload className="size-12 text-zinc-400 mx-auto mb-4" />
      <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
        {t("upload.dragDrop", "Drag and drop your document here")}
      </p>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        {t(
          "upload.supportedFormats",
          "Supports PDF and image files (JPG, PNG, etc.)"
        )}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="primary"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = SUPPORTED_TYPES.join(",");
            input.onchange = e => {
              const target = e.target as {
                files?: { [key: number]: File; length: number } | null;
              };
              if (target.files && target.files.length > 0 && target.files[0]) {
                onFileSelect(target.files[0]);
              }
            };
            input.click();
          }}
        >
          {t("upload.selectFile", "Select File")}
        </Button>
        <Button variant="secondary" onClick={onPaste} disabled={isProcessing}>
          {t("upload.paste.button", "Paste from clipboard")}
        </Button>
      </div>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">
        {t(
          "upload.paste.hint",
          "You can also paste directly with Cmd/Ctrl + V."
        )}
      </p>
    </div>
  );
}

function FilePreview({
  file,
  isProcessing,
  onClear,
}: {
  file: File;
  isProcessing: boolean;
  onClear: () => void;
}) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-50">
      <div className="flex items-center gap-3">
        {getFileIcon(file)}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[var(--text-primary)] truncate">
            {file.name}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            {formatFileSize(file.size)}
          </p>
        </div>
        <Button
          onClick={onClear}
          variant="ghost"
          size="sm"
          icon={<X size={16} />}
          disabled={isProcessing}
        />
      </div>
    </div>
  );
}

function StatusBanner({
  uploadState,
  errorMessage,
  pasteSuccessMessage,
  isProcessing,
}: {
  uploadState: UploadState;
  errorMessage: string;
  pasteSuccessMessage: string;
  isProcessing: boolean;
}) {
  const { t } = useTranslation();

  if (pasteSuccessMessage && uploadState !== "error") {
    return (
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <CheckCircle className="size-5 text-blue-500 shrink-0" />
        <p className="text-sm text-blue-700">{pasteSuccessMessage}</p>
      </div>
    );
  }

  if (uploadState === "error" && errorMessage) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
        <AlertCircle className="size-5 text-red-500 shrink-0" />
        <p className="text-sm text-red-700">{errorMessage}</p>
      </div>
    );
  }

  if (uploadState === "success") {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle className="size-5 text-green-500 shrink-0" />
        <p className="text-sm text-green-700">
          {t("upload.success", "Document processed successfully!")}
        </p>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <Loader className="size-5 text-blue-500 shrink-0 animate-spin" />
        <p className="text-sm text-blue-700">
          {uploadState === "uploading"
            ? t("upload.uploading", "Uploading document...")
            : t("upload.processing", "Analyzing document with AI...")}
        </p>
      </div>
    );
  }

  return null;
}

function ClarificationsField({
  value,
  isProcessing,
  maxLength,
  onChange,
}: {
  value: string;
  isProcessing: boolean;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label
        htmlFor="upload-clarifications"
        className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
      >
        {t("upload.clarifications.label", "Clarifications (optional)")}
      </label>
      <textarea
        id="upload-clarifications"
        aria-label={t(
          "upload.clarifications.label",
          "Clarifications (optional)"
        )}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        maxLength={maxLength}
        disabled={isProcessing}
        placeholder={t(
          "upload.clarifications.placeholder",
          "Provide extra context for the AI (e.g. installment plan, refund, currency hint, etc.)"
        )}
        className="w-full px-4 py-3 rounded-2xl border border-zinc-200 placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)] focus:outline-none transition-colors resize-none"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">
          {t(
            "upload.clarifications.help",
            "Optional notes that help the AI understand ambiguous details."
          )}
        </p>
        <p className="text-xs text-[var(--text-secondary)] tabular-nums">
          {t("upload.clarifications.counter", "{{count}} / {{max}}", {
            count: value.length,
            max: maxLength,
          })}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function UploadTransactionModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
}: UploadTransactionModalProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(uploadFormReducer, initialState);
  const {
    selectedFile,
    dragActive,
    errorMessage,
    uploadState,
    pasteSuccessMessage,
    userClarifications,
  } = state;

  const isProcessing =
    uploadState === "uploading" || uploadState === "processing";

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        return t(
          "upload.errors.unsupportedType",
          "Unsupported file type. Please upload PDF or image files."
        );
      }
      const maxSize =
        file.type === "application/pdf" ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        const maxSizeMB = Math.round(maxSize / (1024 * 1024));
        return t(
          "upload.errors.fileTooLarge",
          `File too large. Maximum size is ${maxSizeMB}MB.`
        );
      }
      return null;
    },
    [t]
  );

  const handleFileSelect = useCallback(
    (file: File, source: "file" | "clipboard" = "file") => {
      const validationError = validateFile(file);
      if (validationError) {
        dispatch({ type: "SET_ERROR", message: validationError });
        return;
      }
      dispatch({
        type: "FILE_SELECTED",
        file,
        pasteMessage:
          source === "clipboard"
            ? t("upload.paste.success", "Image pasted successfully.")
            : "",
      });
    },
    [t, validateFile]
  );

  const getClipboardErrorMessage = useCallback(
    (error: ClipboardReadError): string => {
      switch (error) {
        case "not_supported":
          return t(
            "upload.errors.clipboardNotSupported",
            "Clipboard read is not supported in this browser."
          );
        case "permission_denied":
          return t(
            "upload.errors.clipboardPermissionDenied",
            "Clipboard access was denied. Please allow paste access and try again."
          );
        case "empty":
          return t(
            "upload.errors.clipboardEmpty",
            "No supported file found in clipboard."
          );
        case "read_failed":
        default:
          return t(
            "upload.errors.clipboardReadFailed",
            "Could not read clipboard content."
          );
      }
    },
    [t]
  );

  const { readFromClipboard } = useClipboardFile({
    isEnabled: isOpen && !isProcessing && !selectedFile,
    acceptedMimeTypes: SUPPORTED_TYPES,
    onFile: useCallback(
      (file: File) => {
        handleFileSelect(file, "clipboard");
      },
      [handleFileSelect]
    ),
  });

  const handlePasteFromClipboard = useCallback(async () => {
    if (isProcessing || selectedFile) {
      return;
    }

    const clipboardError = await readFromClipboard();
    if (!clipboardError) {
      return;
    }

    dispatch({
      type: "SET_ERROR",
      message: getClipboardErrorMessage(clipboardError),
    });
  }, [getClipboardErrorMessage, isProcessing, readFromClipboard, selectedFile]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      dispatch({ type: "DRAG_ACTIVE", active: true });
    } else if (e.type === "dragleave") {
      dispatch({ type: "DRAG_ACTIVE", active: false });
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: "DRAG_ACTIVE", active: false });
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0 && files[0]) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect]
  );

  const uploadFile = async () => {
    if (!selectedFile) return;
    dispatch({ type: "SET_UPLOAD_STATE", state: "uploading" });
    try {
      const fileData = await selectedFile.arrayBuffer();
      dispatch({ type: "SET_UPLOAD_STATE", state: "processing" });
      const result = await uploadDocumentForAnalysis(
        fileData,
        selectedFile.name,
        selectedFile.type,
        i18n.language,
        userClarifications.trim() || undefined
      );
      if (result.success && result.transaction) {
        dispatch({ type: "SET_UPLOAD_STATE", state: "success" });
        onSuccess(result.transaction.id as string);
        // process-document/index.ts:62-85 increments the counter
        // BEFORE running the AI extraction. A success means the
        // counter went up. Invalidate the usage panel so the next
        // Settings mount shows the new value.
        queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
        setTimeout(() => {
          onClose();
          dispatch({ type: "RESET" });
        }, 2000);
      } else {
        throw new Error(result.error || "Processing failed");
      }
    } catch (error) {
      // Premium-feature substitution: when the server rejected the
      // upload with a requireMinRole / requireCapability 403, the
      // error message becomes the localized "This is a premium
      // feature" copy instead of the raw "Requires capability: X".
      const errorMsg = getEdgeFunctionErrorMessage(error, t);
      // The pre-increment ran before the AI call, so a 429 from the
      // server still consumed the counter (then rolled it back
      // internally). For other errors the counter is also already
      // incremented. Either way: invalidate.
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
      dispatch({ type: "SET_ERROR", message: errorMsg });
      onError(errorMsg);
    }
  };

  const resetModal = () => {
    dispatch({ type: "RESET" });
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("upload.title", "Upload Document")}
      closeDisabled={isProcessing}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isProcessing}
            fullWidth
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={uploadFile}
            disabled={!selectedFile || uploadState === "success"}
            loading={isProcessing}
            variant="primary"
            fullWidth
          >
            {t("upload.analyze", "Analyze Document")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!selectedFile ? (
          <DropZone
            dragActive={dragActive}
            isProcessing={isProcessing}
            onDrag={handleDrag}
            onDrop={handleDrop}
            onFileSelect={handleFileSelect}
            onPaste={handlePasteFromClipboard}
          />
        ) : (
          <FilePreview
            file={selectedFile}
            isProcessing={isProcessing}
            onClear={() => dispatch({ type: "CLEAR_SELECTED_FILE" })}
          />
        )}

        <ClarificationsField
          value={userClarifications}
          isProcessing={isProcessing}
          maxLength={MAX_CLARIFICATIONS_LENGTH}
          onChange={value => dispatch({ type: "SET_CLARIFICATIONS", value })}
        />

        <StatusBanner
          uploadState={uploadState}
          errorMessage={errorMessage}
          pasteSuccessMessage={pasteSuccessMessage}
          isProcessing={isProcessing}
        />
      </div>
    </Modal>
  );
}

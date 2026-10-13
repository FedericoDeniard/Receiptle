import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { LazyMotion, m, domAnimation, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { TransactionFormModal } from "./TransactionFormModal";
import type { TransactionFormData } from "./TransactionFormModal";
import { UploadTransactionModal } from "./UploadTransactionModal";
import { useTransactionMutations } from "../../hooks/useTransactionMutations";
import { useTagMutations } from "../../hooks/useTagMutations";
import { useReportMutations } from "../../hooks/useReportMutations";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSidebar } from "../../contexts/SidebarContext";
import { mapTransactionFormDataToInsert } from "../../utils/transactionForm";
import { toast } from "../../utils/toast";

type AddTransactionProps = {
  initialData?: TransactionFormData;
  initialTagIds?: string[];
};

export type AddTransactionHandle = {
  openManualAdd: () => void;
  openUpload: () => void;
};

export const AddTransaction = forwardRef<
  AddTransactionHandle,
  AddTransactionProps
>(function AddTransaction({ initialData, initialTagIds }, ref) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createTransaction } = useTransactionMutations();
  const { setTransactionTags } = useTagMutations();
  const { assignTransactionToReport } = useReportMutations();
  const { isOpen: isSidebarOpen } = useSidebar();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const isDisabled = isMobile && isSidebarOpen;

  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>(
    initialTagIds ?? []
  );
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const [preFilledData, setPreFilledData] = useState<
    TransactionFormData | undefined
  >(initialData);

  const fabContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDisabled && isFabOpen) setIsFabOpen(false);
  }, [isDisabled, isFabOpen]);

  useEffect(() => {
    if (!isFabOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const container = fabContainerRef.current;
      if (container && !container.contains(event.target as Node)) {
        setIsFabOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFabOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFabOpen]);

  useImperativeHandle(
    ref,
    () => ({
      openManualAdd: () => {
        setIsFabOpen(false);
        setIsCreateModalOpen(true);
      },
      openUpload: () => {
        setIsFabOpen(false);
        setIsUploadModalOpen(true);
      },
    }),
    []
  );

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setPreFilledData(undefined);
    setPendingTagIds(initialTagIds ?? []);
    setPendingReportId(null);
  };

  const handleCreate = async (formData: TransactionFormData) => {
    const transaction = await createTransaction(
      mapTransactionFormDataToInsert(formData)
    );
    if (pendingTagIds.length > 0) {
      try {
        await setTransactionTags({
          transactionId: transaction.id,
          tagIds: pendingTagIds,
        });
      } catch (error) {
        console.error("Error assigning tags to new transaction:", error);
      }
    }
    if (pendingReportId) {
      try {
        await assignTransactionToReport({
          transactionId: transaction.id,
          reportId: pendingReportId,
        });
      } catch (error) {
        console.error("Error assigning report to new transaction:", error);
      }
    }
    closeCreateModal();
    navigate(`/transactions?id=${transaction.id}`);
  };

  const handleUploadSuccess = (transactionId: string) => {
    toast.success(t("upload.success", "Document processed successfully!"));
    setIsUploadModalOpen(false);
    navigate(`/transactions?id=${transactionId}`);
  };

  const handleUploadError = (error: string) => {
    toast.error(t("upload.error", "Upload failed: {{error}}", { error }));
  };

  return (
    <LazyMotion features={domAnimation}>
      <div
        ref={fabContainerRef}
        data-tour="transaction-fab"
        className="fixed bottom-6 right-6 z-40"
      >
        <Button
          onClick={() => setIsFabOpen(!isFabOpen)}
          variant="primary"
          size="md"
          icon={<Plus size={24} />}
          className="size-14 rounded-full shadow-lg hover:scale-105 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-200"
          aria-label={t("transactions.addTransaction")}
          disabled={isDisabled}
        />

        <AnimatePresence>
          {isFabOpen && (
            <m.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 20 }}
              className="absolute bottom-16 right-0 bg-white rounded-xl shadow-lg p-2 w-64"
            >
              <Button
                onClick={() => {
                  setIsFabOpen(false);
                  setIsCreateModalOpen(true);
                }}
                variant="ghost"
                size="md"
                fullWidth
                className="text-left justify-start"
              >
                {t("transactions.addManually")}
              </Button>
              <Button
                onClick={() => {
                  setIsFabOpen(false);
                  setIsUploadModalOpen(true);
                }}
                variant="ghost"
                size="md"
                fullWidth
                className="text-left justify-start"
              >
                {t("transactions.uploadDocument")}
              </Button>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <TransactionFormModal
        isOpen={isCreateModalOpen}
        onClose={closeCreateModal}
        onSave={handleCreate}
        mode="create"
        initialData={preFilledData}
        initialTagIds={pendingTagIds}
        onTagsChange={setPendingTagIds}
        initialReportId={pendingReportId}
        onReportChange={setPendingReportId}
      />

      <UploadTransactionModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
        onError={handleUploadError}
      />
    </LazyMotion>
  );
});

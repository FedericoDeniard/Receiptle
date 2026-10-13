import { XIcon } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/shadcn/dialog";

export type AttachmentLightboxProps = {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AttachmentLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: AttachmentLightboxProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPortal>
        <DialogOverlay className="bg-black/80" />
        <DialogContent
          showCloseButton={false}
          className="!fixed !inset-0 !top-0 !left-0 !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 gap-0 rounded-none border-0 bg-transparent p-0 shadow-none outline-none data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:!max-w-none"
        >
          <button
            type="button"
            aria-label="Close lightbox"
            className="flex h-full w-full cursor-zoom-out items-center justify-center bg-transparent border-0 p-0"
            onClick={() => onOpenChange(false)}
          >
            <img
              alt={alt}
              className="max-h-[90vh] max-w-[90vw] cursor-default touch-manipulation object-contain select-none"
              draggable={false}
              onClick={event => event.stopPropagation()}
              src={src}
            />
          </button>
          <DialogClose
            aria-label="Close"
            className="!absolute !top-4 !right-4 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white outline-none ring-offset-background transition-opacity hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <XIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

// Extract image and PDF attachments from Gmail messages via REST API
import { extractText, getDocumentProxy } from "npm:unpdf";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES_PER_EMAIL = 3;
const MAX_PDFS_PER_EMAIL = 3;

const SUPPORTED_IMAGE_MIMETYPES = ["image/jpeg", "image/jpg", "image/png"];

export interface ImageAttachment {
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface PdfAttachmentForAiFallback {
  data: Uint8Array;
  mimeType: "application/pdf";
  filename: string;
}

export interface PdfExtractionResult {
  texts: string[];
  fallbackPdfAttachments: PdfAttachmentForAiFallback[];
  // Bytes of every PDF that was successfully downloaded/decoded, regardless of
  // whether its text was extractable. Used to persist the original ticket/receipt
  // alongside the transaction.
  allPdfAttachments: PdfAttachmentForAiFallback[];
}

interface DetectedAttachment {
  attachmentId?: string;
  inlineData?: string;
  filename: string;
  size: number;
  mimeType: string;
}

interface InlineImage {
  data: string; // base64 encoded data from body.data
  filename: string;
  size: number;
  mimeType: string;
}

interface AttachmentDataPayload {
  data?: string;
}

export interface AttachmentRequestOptions {
  fetchAttachmentData?: (
    messageId: string,
    attachmentId: string
  ) => Promise<AttachmentDataPayload | null>;
}

function normalizeMimeType(mimeType: string | undefined): string {
  return (mimeType || "").toLowerCase().trim();
}

function hasFileExtension(
  filename: string | undefined,
  extensions: string[]
): boolean {
  const normalizedFilename = (filename || "").toLowerCase();
  return extensions.some(extension =>
    normalizedFilename.endsWith(`.${extension}`)
  );
}

/**
 * Detect attachments recursively in a Gmail message payload.
 * Includes both regular attachments (attachmentId) and inline binary data (body.data).
 */
function detectAttachments(
  payload: any,
  isSupportedPart: (part: any) => boolean,
  options?: { includeInlineData?: boolean; debugType?: "image" | "pdf" }
): DetectedAttachment[] {
  const attachments: DetectedAttachment[] = [];
  const includeInlineData = options?.includeInlineData ?? false;
  const debugType = options?.debugType ?? "pdf";

  const processPart = (part: any) => {
    const filename = part.filename || "unknown";
    const mimeType = normalizeMimeType(part.mimeType);
    const hasAttachmentId = !!part.body?.attachmentId;
    const hasInlineData = !!part.body?.data;
    const isSupported = isSupportedPart(part);
    const hasDataSource =
      hasAttachmentId || (includeInlineData && hasInlineData);
    const size = part.body?.size || 0;
    const isCandidate =
      !!part?.mimeType && (hasAttachmentId || hasInlineData || !!part.filename);

    if (isCandidate && (!isSupported || size <= 0 || !hasDataSource)) {
      const discardReason = !isSupported
        ? "unsupported_type"
        : size <= 0
          ? "empty_size"
          : includeInlineData
            ? "missing_attachment_data"
            : "inline_data_not_enabled";
      console.log(`[attachment-extractor] Discarded ${debugType} candidate`, {
        filename,
        mimeType,
        size,
        hasAttachmentId,
        hasInlineData,
        discardReason,
      });
    }

    if (part?.mimeType && isSupported && size > 0 && hasDataSource) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        inlineData: includeInlineData ? part.body.data : undefined,
        filename,
        size,
        mimeType,
      });
      console.log(`[attachment-extractor] Detected ${debugType} attachment`, {
        filename,
        mimeType,
        size,
        source: hasAttachmentId ? "attachmentId" : "inlineData",
      });
    }

    if (part.parts && Array.isArray(part.parts)) {
      for (const subPart of part.parts) {
        processPart(subPart);
      }
    }
  };

  processPart(payload);
  return attachments;
}

/**
 * Detect inline images (embedded in email body with base64 data, no attachmentId)
 */
function detectInlineImages(payload: any, mimeTypes: string[]): InlineImage[] {
  const inlineImages: InlineImage[] = [];

  const processPart = (part: any) => {
    if (
      part.mimeType &&
      mimeTypes.includes(normalizeMimeType(part.mimeType)) &&
      !part.body?.attachmentId &&
      part.body?.data &&
      part.body.size > 0
    ) {
      inlineImages.push({
        data: part.body.data,
        filename:
          part.filename ||
          `inline-${inlineImages.length}.${part.mimeType.split("/")[1]}`,
        size: part.body.size,
        mimeType: part.mimeType,
      });
    }

    if (part.parts && Array.isArray(part.parts)) {
      for (const subPart of part.parts) {
        processPart(subPart);
      }
    }
  };

  processPart(payload);
  return inlineImages;
}

/**
 * Convert Gmail's URL-safe base64 to standard base64, then to Uint8Array
 */
function gmailBase64ToUint8Array(data: string): Uint8Array {
  // Gmail uses URL-safe base64 (- and _ instead of + and /)
  const standardBase64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract image attachments from a Gmail message
 *
 * @param accessToken - Gmail OAuth access token
 * @param messageId - Gmail message ID
 * @param payload - The message payload (from messages.get with format=full)
 * @returns Array of image attachments with binary data
 */
export async function extractImageAttachments(
  accessToken: string,
  messageId: string,
  payload: any,
  options?: AttachmentRequestOptions
): Promise<ImageAttachment[]> {
  try {
    const images: ImageAttachment[] = [];
    const supportedImageMimeTypes = SUPPORTED_IMAGE_MIMETYPES.map(mimeType =>
      normalizeMimeType(mimeType)
    );

    // 1. Extract regular image attachments (with attachmentId)
    const detected = detectAttachments(
      payload,
      part => {
        const mimeType = normalizeMimeType(part.mimeType);
        if (supportedImageMimeTypes.includes(mimeType)) {
          return true;
        }

        // Some senders attach images as application/octet-stream.
        if (mimeType === "application/octet-stream") {
          return hasFileExtension(part.filename, ["jpg", "jpeg", "png"]);
        }

        return false;
      },
      { includeInlineData: false, debugType: "image" }
    );
    console.log("[attachment-extractor] Image attachment scan summary", {
      detectedCount: detected.length,
      maxImagesPerEmail: MAX_IMAGES_PER_EMAIL,
    });
    const toProcess = detected
      .filter(a => a.size <= MAX_IMAGE_SIZE_BYTES)
      .slice(0, MAX_IMAGES_PER_EMAIL);

    for (const attachment of toProcess) {
      try {
        let rawData: string | undefined;
        if (attachment.attachmentId) {
          const data = await getAttachmentData(
            accessToken,
            messageId,
            attachment.attachmentId,
            options
          );
          rawData = data?.data;
        } else if (attachment.inlineData) {
          rawData = attachment.inlineData;
        }

        if (!rawData) {
          console.warn(
            `Failed to read attachment data for ${attachment.filename}`
          );
          continue;
        }

        const bytes = gmailBase64ToUint8Array(rawData);
        const normalizedMimeType = normalizeMimeType(attachment.mimeType);
        const resolvedMimeType =
          normalizedMimeType === "application/octet-stream" &&
          hasFileExtension(attachment.filename, ["png"])
            ? "image/png"
            : "image/jpeg";

        images.push({
          data: bytes,
          mimeType:
            normalizedMimeType === "image/png" ? "image/png" : resolvedMimeType,
          filename: attachment.filename,
        });

        console.log(
          `Extracted image attachment: ${attachment.filename} (${bytes.length} bytes)`
        );
      } catch (error) {
        console.warn(
          `Error extracting attachment ${attachment.filename}:`,
          error
        );
      }
    }

    // 2. Extract inline images (embedded in email body with base64 data)
    const remaining = MAX_IMAGES_PER_EMAIL - images.length;
    if (remaining > 0) {
      const inlineImages = detectInlineImages(
        payload,
        SUPPORTED_IMAGE_MIMETYPES
      )
        .filter(a => a.size <= MAX_IMAGE_SIZE_BYTES)
        .slice(0, remaining);

      for (const inline of inlineImages) {
        try {
          const bytes = gmailBase64ToUint8Array(inline.data);
          images.push({
            data: bytes,
            mimeType:
              inline.mimeType === "image/jpg" ? "image/jpeg" : inline.mimeType,
            filename: inline.filename,
          });
          console.log(
            `Extracted inline image: ${inline.filename} (${bytes.length} bytes)`
          );
        } catch (error) {
          console.warn(
            `Error extracting inline image ${inline.filename}:`,
            error
          );
        }
      }
    }

    return images;
  } catch (error) {
    console.warn("Error detecting image attachments:", error);
    return [];
  }
}

/**
 * Download a Gmail attachment and return raw bytes
 */
async function downloadAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  options?: AttachmentRequestOptions
): Promise<Uint8Array | null> {
  const data = await getAttachmentData(
    accessToken,
    messageId,
    attachmentId,
    options
  );
  if (!data?.data) return null;

  return gmailBase64ToUint8Array(data.data);
}

/**
 * Extract text from PDF attachments in a Gmail message using unpdf
 *
 * @param accessToken - Gmail OAuth access token
 * @param messageId - Gmail message ID
 * @param payload - The message payload (from messages.get with format=full)
 * @returns Array of extracted text strings from PDFs
 */
export async function extractPdfDataForAiFallback(
  accessToken: string,
  messageId: string,
  payload: any,
  options?: AttachmentRequestOptions
): Promise<PdfExtractionResult> {
  try {
    const detected = detectAttachments(
      payload,
      part => {
        const mimeType = normalizeMimeType(part.mimeType);
        if (mimeType === "application/pdf") {
          return true;
        }

        // Some providers mark PDFs as octet-stream but keep .pdf filename.
        if (mimeType === "application/octet-stream") {
          return hasFileExtension(part.filename, ["pdf"]);
        }

        return hasFileExtension(part.filename, ["pdf"]);
      },
      { includeInlineData: true, debugType: "pdf" }
    );
    console.log("[attachment-extractor] PDF attachment scan summary", {
      detectedCount: detected.length,
      maxPdfsPerEmail: MAX_PDFS_PER_EMAIL,
    });

    if (detected.length === 0) {
      return { texts: [], fallbackPdfAttachments: [], allPdfAttachments: [] };
    }

    const toProcess = detected
      .filter(a => a.size <= MAX_PDF_SIZE_BYTES)
      .slice(0, MAX_PDFS_PER_EMAIL);

    const texts: string[] = [];
    const fallbackPdfAttachments: PdfAttachmentForAiFallback[] = [];
    const allPdfAttachments: PdfAttachmentForAiFallback[] = [];

    for (const attachment of toProcess) {
      try {
        let bytes: Uint8Array | null = null;
        if (attachment.attachmentId) {
          bytes = await downloadAttachment(
            accessToken,
            messageId,
            attachment.attachmentId,
            options
          );
        } else if (attachment.inlineData) {
          bytes = gmailBase64ToUint8Array(attachment.inlineData);
        }

        if (!bytes) {
          console.warn("[attachment-extractor] PDF bytes unavailable", {
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            source: attachment.attachmentId ? "attachmentId" : "inlineData",
          });
          continue;
        }

        console.log("[attachment-extractor] Processing PDF bytes", {
          filename: attachment.filename,
          byteLength: bytes.length,
        });

        const pdfAttachment: PdfAttachmentForAiFallback = {
          data: bytes,
          mimeType: "application/pdf",
          filename: attachment.filename,
        };
        allPdfAttachments.push(pdfAttachment);

        const pdf = await getDocumentProxy(bytes);
        const { text } = await extractText(pdf, { mergePages: true });

        if (text && text.trim()) {
          texts.push(text);
          console.log(
            `Extracted PDF text: ${attachment.filename} (${text.length} chars)`
          );
        } else {
          console.warn("[attachment-extractor] PDF has no extractable text", {
            filename: attachment.filename,
            byteLength: bytes.length,
          });
          fallbackPdfAttachments.push(pdfAttachment);
        }
      } catch (error) {
        console.warn(`Error extracting PDF ${attachment.filename}:`, error);
      }
    }

    return { texts, fallbackPdfAttachments, allPdfAttachments };
  } catch (error) {
    console.warn("Error detecting PDF attachments:", error);
    return { texts: [], fallbackPdfAttachments: [], allPdfAttachments: [] };
  }
}

async function getAttachmentData(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  options?: AttachmentRequestOptions
): Promise<AttachmentDataPayload | null> {
  if (options?.fetchAttachmentData) {
    return options.fetchAttachmentData(messageId, attachmentId);
  }

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) return null;
  return response.json();
}

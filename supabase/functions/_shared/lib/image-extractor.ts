import Tesseract from "npm:tesseract.js@7.0.0";
import { google, type gmail_v1 } from "npm:googleapis@185.0.0";

type Gmail = gmail_v1.Gmail;

const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_IMAGES_PER_EMAIL = 3;
const OCR_TIMEOUT_MS = 30000;

// Supported image types
const SUPPORTED_IMAGE_MIMETYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/webp",
];

type ImageAttachment = {
  attachmentId: string;
  filename: string;
  size: number;
  mimeType: string;
};

/**
 * Detect image attachments in Gmail message
 */
function detectImageAttachments(payload: any): ImageAttachment[] {
  const attachments: ImageAttachment[] = [];

  const processPart = (part: any) => {
    if (
      SUPPORTED_IMAGE_MIMETYPES.includes(part.mimeType) &&
      part.body?.attachmentId
    ) {
      const filename = part.filename || "unknown.jpg";
      const size = part.body.size || 0;

      attachments.push({
        attachmentId: part.body.attachmentId,
        filename,
        size,
        mimeType: part.mimeType,
      });
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        processPart(subPart);
      }
    }
  };

  processPart(payload);
  return attachments;
}

/**
 * Extract text from image buffer using OCR
 */
async function extractTextFromImageBuffer(
  buffer: Uint8Array,
  filename: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`OCR timeout ${OCR_TIMEOUT_MS}ms`)),
      OCR_TIMEOUT_MS
    );

    Tesseract.recognize(buffer, "spa+eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    })
      .then(({ data: { text } }) => {
        clearTimeout(timeout);
        resolve(text.trim());
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/**
 * Extract text from all image attachments in a Gmail message
 */
export async function extractImageAttachments(
  gmail: Gmail,
  messageId: string
): Promise<string[]> {
  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const payload = res.data.payload;
    if (!payload) return [];

    const attachments = detectImageAttachments(payload).slice(
      0,
      MAX_IMAGES_PER_EMAIL
    );
    const texts: string[] = [];

    for (const att of attachments) {
      if (att.size > MAX_IMAGE_SIZE_BYTES) {
        console.warn(
          `Skipping large image: ${att.filename} (${att.size} bytes)`
        );
        continue;
      }

      try {
        console.log(`Processing image: ${att.filename}`);

        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: att.attachmentId,
        });

        const attachmentData = attRes.data.data;
        if (!attachmentData) continue;

        // Convert base64 URL-safe to regular base64
        const base64Data = attachmentData.replace(/-/g, "+").replace(/_/g, "/");
        const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        const extractedText = await extractTextFromImageBuffer(
          buffer,
          att.filename
        );

        if (extractedText.trim()) {
          texts.push(extractedText);
          console.log(
            `Extracted ${extractedText.length} characters from ${att.filename}`
          );
        } else {
          console.log(`No text found in ${att.filename}`);
        }
      } catch (error) {
        console.error(`Error processing image ${att.filename}:`, error);
        // Continue with other images
      }
    }

    return texts;
  } catch (error) {
    console.error("Error extracting image attachments:", error);
    return [];
  }
}

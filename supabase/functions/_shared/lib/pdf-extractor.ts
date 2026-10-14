import pdfParse from "npm:pdf-parse@2.4.5";
import { google, type gmail_v1 } from "npm:googleapis@185.0.0";

type Gmail = gmail_v1.Gmail;

const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_PDFS_PER_EMAIL = 3;
const EXTRACTION_TIMEOUT_MS = 10000;

type PdfAttachment = {
  attachmentId: string;
  filename: string;
  size: number;
};

function detectPdfAttachments(payload: any): PdfAttachment[] {
  const attachments: PdfAttachment[] = [];

  const processPart = (part: any) => {
    if (part.mimeType === "application/pdf" && part.body?.attachmentId) {
      const filename = part.filename || "unknown.pdf";
      const size = part.body.size || 0;
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename,
        size,
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

async function extractTextFromPdfBuffer(
  buffer: Uint8Array,
  filename: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`PDF timeout ${EXTRACTION_TIMEOUT_MS}ms`)),
      EXTRACTION_TIMEOUT_MS
    );

    pdfParse(buffer)
      .then(({ text }) => {
        clearTimeout(timeout);
        resolve(text);
      })
      .catch(reject);
  });
}

export async function extractPdfAttachments(
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

    const attachments = detectPdfAttachments(payload).slice(
      0,
      MAX_PDFS_PER_EMAIL
    );
    const texts: string[] = [];

    for (const att of attachments) {
      if (att.size > MAX_PDF_SIZE_BYTES) continue;

      try {
        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: att.attachmentId,
        });
        if (attRes.data.data) {
          const buffer = Uint8Array.from(atob(attRes.data.data!), c =>
            c.charCodeAt(0)
          );
          const text = await extractTextFromPdfBuffer(buffer, att.filename);
          if (text.trim()) texts.push(text);
        }
      } catch {}
    }
    return texts;
  } catch {
    return [];
  }
}

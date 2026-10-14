import { getSupabase } from "../lib/supabase";

// Local row type that mirrors public.chat_attachments.
// Will be replaced with `Tables<"chat_attachments">` once the migration is
// applied and `bun docker:db:types` regenerates database.types.ts.
interface ChatAttachmentRow {
  id: string;
  user_id: string;
  thread_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/**
 * Application-level representation of an attachment that has been uploaded
 * to Supabase Storage. Includes a short-lived signed URL the UI can render
 * directly in <img> tags.
 */
export interface ChatAttachment extends ChatAttachmentRow {
  signedUrl: string;
}

const BUCKET = "chat-uploads";
// 1h — matches typical signed URL usage in the UI without holding tokens
// for too long. Supabase Storage max is 604800 (7 days) for service role.
const SIGNED_URL_TTL_SECONDS = 3600;

/** Build the storage path: {userId}/{threadId}/{uuid}.{ext} */
function buildStoragePath(
  userId: string,
  threadId: string,
  filename: string
): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  const uuid = crypto.randomUUID();
  return `${userId}/${threadId}/${uuid}.${ext}`;
}

/**
 * Upload a file to the private `chat-uploads` bucket, insert the metadata
 * row in public.chat_attachments, and return a signed URL for the UI.
 *
 * Path convention: {userId}/{threadId}/{uuid}.{ext}
 * (enforced by storage RLS policy `(storage.foldername(name))[1] = auth.uid()::text`).
 */
async function uploadChatAttachment(
  threadId: string,
  file: File
): Promise<ChatAttachment> {
  const supabase = await getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    throw new Error("Authentication required");
  }

  const storagePath = buildStoragePath(user.id, threadId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: row, error: insertError } = await supabase
    .from("chat_attachments" as never)
    .insert({
      user_id: user.id,
      thread_id: threadId,
      storage_path: storagePath,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    } as never)
    .select("*")
    .single();

  if (insertError || !row) {
    // Best-effort cleanup: remove the uploaded object so we don't leak storage.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(
      `Failed to record attachment: ${insertError?.message ?? "unknown error"}`
    );
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signed?.signedUrl) {
    throw new Error(
      `Failed to sign attachment URL: ${signedError?.message ?? "unknown error"}`
    );
  }

  return {
    ...(row as unknown as ChatAttachmentRow),
    signedUrl: signed.signedUrl,
  };
}

/**
 * Upload multiple files in parallel. Returns successful uploads in order;
 * the caller decides how to surface failures (toast, partial state, etc).
 */
export async function uploadChatAttachments(
  threadId: string,
  files: File[]
): Promise<ChatAttachment[]> {
  const results = await Promise.allSettled(
    files.map(file => uploadChatAttachment(threadId, file))
  );

  const successful: ChatAttachment[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      successful.push(r.value);
    } else {
      const file = files[i];
      console.error(
        `[chat-attachments] failed to upload ${file?.name ?? "file"}:`,
        r.reason
      );
    }
  }
  return successful;
}

/**
 * Delete uploaded attachments from Supabase Storage and drop the metadata
 * rows. Used to roll back a send when the model rejects the request
 * (e.g. text-only model receiving an image). Best-effort: errors are
 * logged but not thrown, so the caller can still surface a friendly
 * message to the user.
 */
export async function deleteChatAttachments(
  attachments: ChatAttachment[]
): Promise<void> {
  if (attachments.length === 0) return;
  const supabase = await getSupabase();
  const paths = attachments.map(a => a.storage_path);
  const ids = attachments.map(a => a.id);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove(paths);
  if (storageError) {
    console.error(
      "[chat-attachments] failed to delete storage objects:",
      storageError
    );
  }

  const { error: dbError } = await supabase
    .from("chat_attachments" as never)
    .delete()
    .in("id", ids as never[]);
  if (dbError) {
    console.error(
      "[chat-attachments] failed to delete attachment rows:",
      dbError
    );
  }
}

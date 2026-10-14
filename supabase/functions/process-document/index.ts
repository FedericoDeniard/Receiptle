// Process Document Edge Function - Extract transactions from uploaded files
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireMinRole, requireUserAuth } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { analyzeDocumentForTransaction } from "../_shared/lib/document-analysis.ts";
import { saveTransactionAttachments } from "../_shared/lib/transaction-attachments.ts";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CLARIFICATIONS_LENGTH = 250;

Deno.serve(async req => {
  const preflightResponse = handleCorsPreflightRequest(req);
  if (preflightResponse) {
    return preflightResponse;
  }
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const auth = await requireUserAuth(req, corsHeaders);
    if (auth instanceof Response) {
      return auth;
    }
    const { user } = auth;

    const roleCheck = requireMinRole(auth, "processDocument", corsHeaders);
    if (roleCheck instanceof Response) {
      return roleCheck;
    }

    const cap = await requireCapability(auth, "process_documents", corsHeaders);
    if (cap instanceof Response) {
      return cap;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Usage cap. admin bypasses (effectively unlimited); everyone
    // else — including tester — is counted against the per-period
    // budget in payments.usage_limits. We check-and-increment before
    // any AI tokens are spent so a 429 reaches the client cleanly.
    // The body uses the prefix the frontend classifier matches on to
    // surface the "usage limit" toast via getEdgeFunctionErrorMessage.
    if (auth.role !== "admin") {
      const { data: usage, error: usageError } = await supabase
        .schema("payments")
        .rpc("check_and_increment_usage", {
          target_user_id: auth.user.id,
          cap: "process_documents",
        });
      if (usageError) {
        // fail-open: a counter bug should not break the app for paying
        // users. log so we notice in observability.
        console.error(
          "[process-document] usage check failed; failing open",
          usageError
        );
      } else if (!usage?.[0]?.allowed) {
        return new Response(
          JSON.stringify({ error: "Usage limit exceeded: process_documents" }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const contentType = req.headers.get("content-type") || "";
    const fileName = req.headers.get("x-file-name") || "unknown";
    const userLocale =
      req.headers.get("x-user-locale") ||
      req.headers
        .get("accept-language")
        ?.split(",")[0]
        ?.split(";")[0]
        ?.trim() ||
      undefined;

    const rawClarifications = req.headers.get("x-user-clarifications");
    const userClarifications = rawClarifications
      ? rawClarifications.trim().slice(0, MAX_CLARIFICATIONS_LENGTH) ||
        undefined
      : undefined;

    if (userClarifications) {
      console.log(
        `[process-document] User clarifications received (${userClarifications.length} chars): ${userClarifications}`
      );
    } else if (rawClarifications) {
      console.warn(
        "[process-document] x-user-clarifications header was present but empty after trim, ignoring"
      );
    }

    const arrayBuffer = await req.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);

    if (fileBytes.length === 0) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (fileBytes.length > MAX_SIZE) {
      return new Response(
        JSON.stringify({ error: "File too large. Maximum size is 5MB." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!ALLOWED_TYPES.includes(contentType)) {
      return new Response(
        JSON.stringify({
          error: "Unsupported file type. Only PDF and image files are allowed.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let userFullName: string | undefined;
    const { data: userData } = await supabase.auth.admin.getUserById(user.id);
    if (userData?.user?.user_metadata?.full_name) {
      userFullName = userData.user.user_metadata.full_name;
    }

    const aiResult = await analyzeDocumentForTransaction({
      kind: "upload",
      fileBytes,
      contentType,
      fileName,
      userFullName,
      userLocale,
      userClarifications,
    });

    if (aiResult.aiError) {
      console.error(
        "AI processing failed for uploaded document:",
        aiResult.reason
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: aiResult.reason || "AI processing failed",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (aiResult.hasTransaction) {
      console.log(
        "AI successfully extracted transaction from uploaded document"
      );

      const transaction = aiResult.data;

      const { data: savedTransaction, error: insertError } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          source_email: "manual-upload",
          source_message_id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: new Date().toISOString(),
          amount: transaction.amount,
          currency: transaction.currency || "USD",
          transaction_type: transaction.type,
          name: transaction.name || fileName.replace(/\.[^.]+$/, ""),
          transaction_description: transaction.description,
          transaction_date:
            transaction.date || new Date().toISOString().split("T")[0],
          merchant: transaction.merchant,
          category: transaction.category,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error saving transaction:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save transaction" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (aiResult.attachments.length > 0) {
        await saveTransactionAttachments({
          supabase,
          transactionId: savedTransaction.id,
          userId: savedTransaction.user_id,
          attachments: aiResult.attachments,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          transaction: savedTransaction,
          message: "Transaction created successfully from document",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      console.log(
        "AI could not extract transaction from uploaded document:",
        aiResult.reason
      );

      return new Response(
        JSON.stringify({
          success: false,
          error:
            aiResult.reason ||
            "Could not extract transaction data from document",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Error in process-document:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

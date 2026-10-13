/**
 * SSE comments (`: keepalive`) keep a streaming response alive while
 * the producer is quiet — the model is thinking, a tool query is
 * running, or the next provider chunk is late. Bun.serve closes
 * connections that go ~10s without bytes in either direction (and
 * proxies may impose their own idle timeouts), which used to cut chat
 * responses mid-stream: the client saw
 * `net::ERR_HTTP2_PROTOCOL_ERROR 200 (OK)` while the agent kept
 * running server-side. The AI SDK's SSE parser ignores comment lines.
 */
const SSE_HEARTBEAT_INTERVAL_MS = 5_000;

export function withSseHeartbeats(
  source: ReadableStream<string>,
  intervalMs = SSE_HEARTBEAT_INTERVAL_MS
): ReadableStream<string> {
  const reader = source.getReader();
  type ReadResult = Awaited<ReturnType<typeof reader.read>>;
  // Reused across pulls: a quiet tick must not leave a dangling read
  // behind, since a second concurrent read would race the first and
  // could swallow a chunk.
  let pending: ReturnType<typeof reader.read> | null = null;
  return new ReadableStream<string>({
    async pull(controller) {
      const readPromise = (pending ??= reader.read());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<"tick">(resolve => {
        timer = setTimeout(() => resolve("tick"), intervalMs);
      });
      let outcome: "tick" | ReadResult;
      try {
        outcome = await Promise.race([readPromise, tick]);
      } finally {
        clearTimeout(timer);
      }
      if (outcome === "tick") {
        controller.enqueue(": keepalive\n\n");
        return;
      }
      pending = null;
      if (outcome.done) {
        controller.close();
        return;
      }
      controller.enqueue(outcome.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

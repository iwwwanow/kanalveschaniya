import { logger } from "../../logger";

// Incident 2026-08-26/27: the bot process hung (event loop stalled under host
// I/O pressure) without crashing, so k8s never restarted it — only a full
// physical Pi reboot recovered it. This heartbeat ticks on a plain interval;
// if the event loop is stalled, the interval stops firing and /healthz goes
// stale, which is what the liveness probe acts on.
const STALE_AFTER_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export function startHealthServer(port: number): void {
  let lastHeartbeat = Date.now();
  setInterval(() => {
    lastHeartbeat = Date.now();
  }, HEARTBEAT_INTERVAL_MS);

  Bun.serve({
    port,
    fetch(req) {
      if (new URL(req.url).pathname !== "/healthz") {
        return new Response("not found", { status: 404 });
      }
      const staleFor = Date.now() - lastHeartbeat;
      if (staleFor > STALE_AFTER_MS) {
        return new Response(`stale for ${staleFor}ms`, { status: 503 });
      }
      return new Response("ok", { status: 200 });
    },
  });

  logger.info(`health server listening on :${port}`);
}

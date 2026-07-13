import { createServer as createViteServer } from "vite";
import { loadConfig } from "./config.js";
import { installProcessSafetyHandlers } from "./process-safety.js";
import { createLinkServer } from "./server.js";

installProcessSafetyHandlers();
const config = loadConfig();
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const server = createLinkServer(config, vite.middlewares);

server.listen(config.port, config.host, () => {
  console.log(`watermelon-link development server at ${config.publicOrigin}`);
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite.close();
  const timeout = setTimeout(() => {
    console.error("shutdown_timeout");
    process.exit(0);
  }, 5_000);
  timeout.unref();
  server.shutdown((error) => {
    clearTimeout(timeout);
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

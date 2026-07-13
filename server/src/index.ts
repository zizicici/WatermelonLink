import { loadConfig } from "./config.js";
import { installProcessSafetyHandlers } from "./process-safety.js";
import { createLinkServer } from "./server.js";

installProcessSafetyHandlers();
const config = loadConfig();
const server = createLinkServer(config);

server.listen(config.port, config.host, () => {
  console.log(`watermelon-link listening on ${config.host}:${config.port}`);
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

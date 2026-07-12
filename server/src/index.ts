import { loadConfig } from "./config.js";
import { createLinkServer } from "./server.js";

const config = loadConfig();
const server = createLinkServer(config);

server.listen(config.port, config.host, () => {
  console.log(`watermelon-link listening on ${config.host}:${config.port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

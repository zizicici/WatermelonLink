import { createServer as createViteServer } from "vite";
import { loadConfig } from "./config.js";
import { createLinkServer } from "./server.js";

const config = loadConfig();
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const server = createLinkServer(config, vite.middlewares);

server.listen(config.port, config.host, () => {
  console.log(`watermelon-link development server at ${config.publicOrigin}`);
});

async function shutdown(): Promise<void> {
  await vite.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

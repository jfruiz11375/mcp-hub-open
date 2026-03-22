import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { RegistryService } from "./services/registry-service.js";
import { registerServerRoutes } from "./routes/servers.js";

async function main() {
  const app = Fastify({ logger: true });
  const registry = new RegistryService();
  await registry.ensureStore();

  await app.register(cors, {
    origin: true
  });

  await registerServerRoutes(app);

  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });

  app.log.info(`API listening on http://localhost:${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

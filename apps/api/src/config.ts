import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.resolve(process.cwd(), "../../runtime");

export const config = {
  port: Number(process.env.API_PORT || 4010),
  dataDir,
  reposDir: path.join(dataDir, "repos"),
  dataFile: path.join(dataDir, "data", "servers.json"),
  usersFile: path.join(dataDir, "data", "users.json"),
  nodesFile: path.join(dataDir, "data", "nodes.json"),
  logsDir: path.join(dataDir, "logs"),
  localNodeId: process.env.LOCAL_NODE_ID || "node-local",
  allowedGithubHosts: (process.env.ALLOWED_GITHUB_HOSTS || "github.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  enableUnsafeCommands: process.env.ENABLE_UNSAFE_COMMANDS === "true",
  requireAuth: process.env.REQUIRE_AUTH !== "false",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  vaultMasterKey: process.env.VAULT_MASTER_KEY || "dev-only-master-key-change-me",
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123!",
  oidcIssuer: process.env.OIDC_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI,
  oidcScope: process.env.OIDC_SCOPE || "openid profile email"
};

import { useEffect, useMemo, useState } from "react";
import { api, setToken, type ClusterNode, type ManagedServer } from "./lib/api";
import { StatCard } from "./components/StatCard";
import { ServerTable } from "./components/ServerTable";
import { ServerForm } from "./components/ServerForm";
import { LogsPanel } from "./components/LogsPanel";

export default function App() {
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [selected, setSelected] = useState<ManagedServer | null>(null);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123!");
  const [userRole, setUserRole] = useState<string>("");

  async function refresh() {
    try {
      const [serverData, nodeData] = await Promise.all([api.listServers(), api.listNodes()]);
      setServers(serverData);
      setNodes(nodeData);
      if (selected) {
        const latest = serverData.find((item) => item.id === selected.id) || null;
        setSelected(latest);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    }
  }

  async function refreshLogs(id: string) {
    try {
      const result = await api.getLogs(id);
      setLog(result.log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const health = await api.health();
        setAuthRequired(health.authRequired);
        if (!health.authRequired) {
          setIsAuthenticated(true);
          await refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect to API");
      }
    })();
  }, []);

  useEffect(() => {
    if (selected) {
      void refreshLogs(selected.id);
    }
  }, [selected]);

  const stats = useMemo(() => {
    const running = servers.filter((item) => item.status === "running").length;
    const errors = servers.filter((item) => item.status === "error").length;
    const installed = servers.filter((item) => item.installedPath).length;
    const dockerIsolated = servers.filter((item) => item.isolation?.mode === "docker").length;
    return { total: servers.length, running, errors, installed, dockerIsolated };
  }, [servers]);

  async function handleLogin() {
    setBusy("login");
    setError(null);
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      setIsAuthenticated(true);
      setUserRole(result.user.role);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(null);
    }
  }

  async function withBusy<T>(label: string, work: () => Promise<T>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      await refresh();
      if (selected) {
        await refreshLogs(selected.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  if (authRequired && !isAuthenticated) {
    return (
      <div className="app-shell centered-shell">
        <div className="card form-card auth-card">
          <div className="section-header compact">
            <div>
              <h2>MCP Hub Open</h2>
              <p className="muted">Sign in with local admin credentials. OIDC can be enabled from environment variables.</p>
            </div>
          </div>
          {error && <div className="error-banner">{error}</div>}
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary" onClick={() => void handleLogin()} disabled={Boolean(busy)}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>MCP Hub Open</h1>
          <p className="muted">Secure control plane for many MCP servers</p>
        </div>
        <nav>
          <a className="active">Dashboard</a>
          <a>Servers</a>
          <a>Nodes</a>
          <a>Registry</a>
          <a>Logs</a>
          <a>Settings</a>
        </nav>
        <div className="sidebar-footnote muted">
          Auth: {authRequired ? `enabled (${userRole || "signed in"})` : "disabled"}
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">OAuth-ready auth, secret vaults, Docker isolation, RBAC, nodes, and MCP proxying</p>
          </div>
          {busy && <div className="busy-pill">Working: {busy}</div>}
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="stats-grid">
          <StatCard label="Total servers" value={stats.total} />
          <StatCard label="Running" value={stats.running} />
          <StatCard label="Installed" value={stats.installed} />
          <StatCard label="Errors" value={stats.errors} />
          <StatCard label="Docker isolated" value={stats.dockerIsolated} />
          <StatCard label="Cluster nodes" value={nodes.length} />
        </section>

        <section className="content-grid">
          <div className="left-column">
            <ServerTable
              servers={servers}
              onSelect={(server) => setSelected(server)}
              onInstall={(id) => withBusy(`install:${id}`, async () => void api.installServer(id))}
              onStart={(id) => withBusy(`start:${id}`, async () => void api.startServer(id))}
              onStop={(id) => withBusy(`stop:${id}`, async () => void api.stopServer(id))}
            />

            <div className="card details-card">
              <div className="section-header compact">
                <div>
                  <h2>Selected Server</h2>
                  <p className="muted">{selected ? selected.name : "Pick a server from the table"}</p>
                </div>
              </div>

              {selected ? (
                <div className="details-grid">
                  <div><strong>ID</strong><div>{selected.id}</div></div>
                  <div><strong>Status</strong><div>{selected.status}</div></div>
                  <div><strong>Target node</strong><div>{selected.targetNodeId || "node-local"}</div></div>
                  <div><strong>Isolation</strong><div>{selected.isolation?.mode || "process"}</div></div>
                  <div><strong>Verification</strong><div>{selected.packageVerification?.mode || "none"}</div></div>
                  <div><strong>Installed path</strong><div>{selected.installedPath || "—"}</div></div>
                  <div><strong>Working directory</strong><div>{selected.workingDirectory || "—"}</div></div>
                  <div><strong>Start command</strong><div>{selected.startCommand || "—"}</div></div>
                  <div><strong>Last error</strong><div>{selected.lastError || "—"}</div></div>
                </div>
              ) : (
                <div className="muted">No server selected.</div>
              )}
            </div>

            <div className="card details-card">
              <div className="section-header compact">
                <div>
                  <h2>Cluster Nodes</h2>
                  <p className="muted">Multi-node orchestration preview</p>
                </div>
              </div>
              <div className="details-grid">
                {nodes.map((node) => (
                  <div key={node.id}>
                    <strong>{node.name}</strong>
                    <div>{node.id}</div>
                    <div>{node.status}</div>
                    <div>{node.lastHeartbeatAt}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="right-column">
            <ServerForm
              onCreate={async (payload) => {
                await api.createServer(payload as never);
                await refresh();
              }}
            />
            <LogsPanel title={selected?.name || "No selection"} log={log} />
          </div>
        </section>
      </main>
    </div>
  );
}

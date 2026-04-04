import { useEffect, useMemo, useState } from "react";
import { api, setToken, type ClusterNode, type ManagedServer } from "./lib/api";
import { StatCard } from "./components/StatCard";
import { ServerTable } from "./components/ServerTable";
import { ServerForm } from "./components/ServerForm";
import { LogsPanel } from "./components/LogsPanel";

type Page = "dashboard" | "servers" | "nodes" | "logs" | "settings";

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
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [editingServer, setEditingServer] = useState<ManagedServer | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

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

  const selectedMcpEndpoint = useMemo(() => {
    if (!selected) return "";
    return `${window.location.origin}/api/servers/${selected.id}/mcp`;
  }, [selected]);

  async function copyEndpoint() {
    if (!selectedMcpEndpoint) return;
    const payload = `POST ${selectedMcpEndpoint}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopyNotice("Endpoint copied");
      setTimeout(() => setCopyNotice(null), 1500);
    } catch {
      setCopyNotice("Copy failed");
      setTimeout(() => setCopyNotice(null), 1500);
    }
  }

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      await refresh();
      if (selected) {
        await refreshLogs(selected.id);
      }
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
          <a className={currentPage === "dashboard" ? "active" : ""} onClick={() => setCurrentPage("dashboard")} style={{ cursor: "pointer" }}>Dashboard</a>
          <a className={currentPage === "servers" ? "active" : ""} onClick={() => setCurrentPage("servers")} style={{ cursor: "pointer" }}>Servers</a>
          <a className={currentPage === "nodes" ? "active" : ""} onClick={() => setCurrentPage("nodes")} style={{ cursor: "pointer" }}>Nodes</a>
          <a className={currentPage === "logs" ? "active" : ""} onClick={() => setCurrentPage("logs")} style={{ cursor: "pointer" }}>Logs</a>
          <a className={currentPage === "settings" ? "active" : ""} onClick={() => setCurrentPage("settings")} style={{ cursor: "pointer" }}>Settings</a>
        </nav>
        <div className="sidebar-footnote muted">
          Auth: {authRequired ? `enabled (${userRole || "signed in"})` : "disabled"}
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            {currentPage === "dashboard" && <><h2>Dashboard</h2><p className="muted">OAuth-ready auth, secret vaults, Docker isolation, RBAC, nodes, and MCP proxying</p></>}
            {currentPage === "servers" && <><h2>Servers</h2><p className="muted">Manage and operate your registered MCP servers</p></>}
            {currentPage === "nodes" && <><h2>Cluster Nodes</h2><p className="muted">Multi-node orchestration and heartbeat tracking</p></>}
            {currentPage === "logs" && <><h2>Logs</h2><p className="muted">Runtime output for the selected server</p></>}
            {currentPage === "settings" && <><h2>Settings</h2><p className="muted">Current environment configuration</p></>}
          </div>
          {busy && <div className="busy-pill">Working: {busy}</div>}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {currentPage === "dashboard" && (
          <section className="stats-grid">
            <StatCard label="Total servers" value={stats.total} />
            <StatCard label="Running" value={stats.running} />
            <StatCard label="Installed" value={stats.installed} />
            <StatCard label="Errors" value={stats.errors} />
            <StatCard label="Docker isolated" value={stats.dockerIsolated} />
            <StatCard label="Cluster nodes" value={nodes.length} />
          </section>
        )}

        {currentPage === "servers" && (
          <section className="content-grid">
            <div className="left-column">
              <ServerTable
                servers={servers}
                onSelect={(server) => {
                  setSelected(server);
                  setEditingServer(null);
                }}
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
                  <>
                    <div className="details-grid">
                      <div><strong>ID</strong><div>{selected.id}</div></div>
                      <div><strong>Status</strong><div>{selected.status}</div></div>
                      <div><strong>Target node</strong><div>{selected.targetNodeId || "node-local"}</div></div>
                      <div><strong>Isolation</strong><div>{selected.isolation?.mode || "process"}</div></div>
                      <div><strong>Verification</strong><div>{selected.packageVerification?.mode || "none"}</div></div>
                      <div><strong>Subdirectory</strong><div>{selected.subdirectory || "—"}</div></div>
                      <div><strong>Installed path</strong><div>{selected.installedPath || "—"}</div></div>
                      <div><strong>Working directory</strong><div>{selected.workingDirectory || "—"}</div></div>
                      <div><strong>Start command</strong><div>{selected.startCommand || "—"}</div></div>
                      <div><strong>MCP endpoint</strong><div>{selectedMcpEndpoint}</div></div>
                      <div><strong>MCP method</strong><div>POST</div></div>
                      <div><strong>Last error</strong><div>{selected.lastError || "—"}</div></div>
                    </div>
                    <div className="button-row" style={{ marginTop: "0.75rem" }}>
                      <button onClick={() => void copyEndpoint()}>Copy Endpoint</button>
                      {copyNotice && <div className="muted">{copyNotice}</div>}
                    </div>
                    <div className="button-row" style={{ marginTop: "1rem" }}>
                      <button
                        className="primary"
                        onClick={() => {
                          setEditingServer(selected);
                        }}
                      >
                        Edit Server
                      </button>
                      <button
                        onClick={() => {
                          const confirmed = window.confirm(`Delete server ${selected.name}? This cannot be undone.`);
                          if (!confirmed) return;
                          void withBusy(`delete:${selected.id}`, async () => {
                            await api.deleteServer(selected.id);
                            setEditingServer(null);
                            setSelected(null);
                          });
                        }}
                      >
                        Delete Server
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="muted">No server selected.</div>
                )}
              </div>
            </div>
            <div className="right-column">
              <ServerForm
                editingServer={editingServer}
                onCreate={async (payload) => {
                  await api.createServer(payload);
                  setEditingServer(null);
                  await refresh();
                }}
                onUpdate={async (id, payload) => {
                  await api.updateServer(id, payload);
                  setEditingServer(null);
                  await refresh();
                }}
                onCancelEdit={() => setEditingServer(null)}
              />
            </div>
          </section>
        )}

        {currentPage === "nodes" && (
          <div className="card details-card">
            <div className="section-header compact">
              <div>
                <h2>Cluster Nodes</h2>
                <p className="muted">Registered nodes and their heartbeat status</p>
              </div>
            </div>
            {nodes.length === 0 ? (
              <div className="muted">No nodes registered yet.</div>
            ) : (
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
            )}
          </div>
        )}

        {currentPage === "logs" && (
          <LogsPanel title={selected?.name || "No server selected"} log={log} />
        )}

        {currentPage === "settings" && (
          <div className="card details-card">
            <div className="section-header compact">
              <div><h2>Environment</h2><p className="muted">Active runtime configuration</p></div>
            </div>
            <div className="details-grid">
              <div><strong>Auth required</strong><div>{authRequired ? "Yes" : "No"}</div></div>
              <div><strong>Signed-in role</strong><div>{userRole || "—"}</div></div>
              <div><strong>API URL</strong><div>http://localhost:4010</div></div>
              <div><strong>Local node ID</strong><div>node-local</div></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

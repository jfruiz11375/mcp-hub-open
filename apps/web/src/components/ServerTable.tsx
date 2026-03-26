import type { ManagedServer } from "../lib/api";

interface Props {
  servers: ManagedServer[];
  onInstall: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onSelect: (server: ManagedServer) => void;
}

export function ServerTable({ servers, onInstall, onStart, onStop, onSelect }: Props) {
  return (
    <div className="card table-card">
      <div className="section-header">
        <div>
          <h2>Managed MCP Servers</h2>
          <p className="muted">Local registry, install, start, stop, and log access</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Runtime</th>
            <th>Repo</th>
            <th>Branch</th>
            <th>Last Error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => {
            const isRemote = server.runtimeKind === "remote";
            const canInstall = !isRemote && Boolean(server.repoUrl);
            const canStart = !isRemote && server.status !== "running" && Boolean(server.startCommand);
            const installHint = isRemote
              ? "Remote servers do not support local install"
              : server.repoUrl
                ? "Install dependencies/build from repository"
                : "Set a repository URL before install";
            const startHint = isRemote
              ? "Remote servers do not run as local processes"
              : server.startCommand
                ? "Start the configured process"
                : "Set a start command before starting";

            return (
              <tr key={server.id}>
                <td>
                  <button className="link-button" onClick={() => onSelect(server)}>
                    {server.name}
                  </button>
                </td>
                <td>
                  <span className={`badge badge-${server.status}`}>{server.status}</span>
                </td>
                <td>{server.runtimeKind}</td>
                <td className="truncate-cell">{server.repoUrl || server.remoteUrl || "—"}</td>
                <td>{server.branch || "—"}</td>
                <td className="truncate-cell">{server.lastError || "—"}</td>
                <td>
                  <div className="button-row">
                    <button disabled={!canInstall} title={installHint} onClick={() => onInstall(server.id)}>
                      Install
                    </button>
                    {server.status === "running" ? (
                      <button onClick={() => onStop(server.id)}>Stop</button>
                    ) : (
                      <button
                        className="primary"
                        disabled={!canStart}
                        title={startHint}
                        onClick={() => onStart(server.id)}
                      >
                        Start
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {servers.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-state-cell">
                No servers yet. Add one from the form on the right.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
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
              <td>
                <div className="button-row">
                  <button onClick={() => onInstall(server.id)}>Install</button>
                  {server.status === "running" ? (
                    <button onClick={() => onStop(server.id)}>Stop</button>
                  ) : (
                    <button className="primary" onClick={() => onStart(server.id)}>
                      Start
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {servers.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state-cell">
                No servers yet. Add one from the form on the right.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

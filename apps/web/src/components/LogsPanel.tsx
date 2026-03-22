interface Props {
  title: string;
  log: string;
}

export function LogsPanel({ title, log }: Props) {
  return (
    <div className="card logs-card">
      <div className="section-header compact">
        <div>
          <h2>Logs</h2>
          <p className="muted">{title}</p>
        </div>
      </div>
      <pre>{log || "No logs yet."}</pre>
    </div>
  );
}

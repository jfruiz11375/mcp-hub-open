import { useEffect, useMemo, useState } from "react";
import type { IsolationMode, ManagedServer, RuntimeKind, TransportType, VerificationMode } from "../lib/api";

interface Props {
  editingServer?: ManagedServer | null;
  onCreate: (payload: {
    id: string;
    name: string;
    description?: string;
    repoUrl?: string;
    branch?: string;
    subdirectory?: string;
    runtimeKind: RuntimeKind;
    transportType: TransportType;
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    remoteUrl?: string;
    targetNodeId?: string;
    isolation?: { mode: IsolationMode; dockerImage?: string };
    packageVerification?: { mode: VerificationMode; targetPath?: string; expectedSha256?: string; manifestPath?: string; signaturePath?: string; publicKeyPem?: string };
    env: { key: string; value: string; secret?: boolean }[];
  }) => Promise<void>;
  onUpdate?: (
    id: string,
    payload: {
      name: string;
      repoUrl?: string;
      branch?: string;
      subdirectory?: string;
      runtimeKind: RuntimeKind;
      transportType: TransportType;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
      remoteUrl?: string;
      targetNodeId?: string;
      isolation?: { mode: IsolationMode; dockerImage?: string };
      packageVerification?: { mode: VerificationMode; targetPath?: string; expectedSha256?: string; manifestPath?: string; signaturePath?: string; publicKeyPem?: string };
      env: { key: string; value: string; secret?: boolean }[];
    }
  ) => Promise<void>;
  onCancelEdit?: () => void;
}

export function ServerForm({ editingServer, onCreate, onUpdate, onCancelEdit }: Props) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [subdirectory, setSubdirectory] = useState("");
  const [runtimeKind, setRuntimeKind] = useState<RuntimeKind>("node");
  const [transportType, setTransportType] = useState<TransportType>("stdio");
  const [installCommand, setInstallCommand] = useState("npm install");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [startCommand, setStartCommand] = useState("node dist/index.js");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("node-local");
  const [isolationMode, setIsolationMode] = useState<IsolationMode>("process");
  const [dockerImage, setDockerImage] = useState("node:20-alpine");
  const [verificationMode, setVerificationMode] = useState<VerificationMode>("none");
  const [targetPath, setTargetPath] = useState("package.json");
  const [expectedSha256, setExpectedSha256] = useState("");
  const [manifestPath, setManifestPath] = useState("release-manifest.json");
  const [signaturePath, setSignaturePath] = useState("release-manifest.sig");
  const [publicKeyPem, setPublicKeyPem] = useState("");
  const [envText, setEnvText] = useState("LOG_LEVEL=info");
  const [saving, setSaving] = useState(false);

  const id = useMemo(
    () =>
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    [name]
  );

  const effectiveId = editingServer?.id || id;

  function applyServerToForm(server: ManagedServer) {
    setName(server.name);
    setRepoUrl(server.repoUrl || "");
    setBranch(server.branch || "main");
    setSubdirectory(server.subdirectory || "");
    setRuntimeKind(server.runtimeKind);
    setTransportType(server.transportType);
    setInstallCommand(server.installCommand || "npm install");
    setBuildCommand(server.buildCommand || "npm run build");
    setStartCommand(server.startCommand || "node dist/index.js");
    setRemoteUrl(server.remoteUrl || "");
    setTargetNodeId(server.targetNodeId || "node-local");
    setIsolationMode(server.isolation?.mode || "process");
    setDockerImage(server.isolation?.dockerImage || "node:20-alpine");
    const verification = server.packageVerification?.mode || "none";
    setVerificationMode(verification);
    setTargetPath(server.packageVerification?.targetPath || "package.json");
    setExpectedSha256(server.packageVerification?.expectedSha256 || "");
    setManifestPath(server.packageVerification?.manifestPath || "release-manifest.json");
    setSignaturePath(server.packageVerification?.signaturePath || "release-manifest.sig");
    setPublicKeyPem(server.packageVerification?.publicKeyPem || "");
    setEnvText(
      (server.env || [])
        .map((item) => `${item.key}=${item.value}`)
        .join("\n") || "LOG_LEVEL=info"
    );
  }

  function resetForm() {
    setName("");
    setRepoUrl("");
    setBranch("main");
    setSubdirectory("");
    setRuntimeKind("node");
    setTransportType("stdio");
    setInstallCommand("npm install");
    setBuildCommand("npm run build");
    setStartCommand("node dist/index.js");
    setRemoteUrl("");
    setTargetNodeId("node-local");
    setIsolationMode("process");
    setDockerImage("node:20-alpine");
    setVerificationMode("none");
    setExpectedSha256("");
    setPublicKeyPem("");
    setEnvText("LOG_LEVEL=info");
  }

  useEffect(() => {
    if (editingServer) {
      applyServerToForm(editingServer);
    } else {
      resetForm();
    }
  }, [editingServer?.id]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const env = envText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return { key: key.trim(), value: rest.join("=").trim(), secret: /password|secret|token/i.test(key) };
        });

      const packageVerification = verificationMode === "none"
        ? { mode: "none" as const }
        : verificationMode === "checksum"
          ? { mode: "checksum" as const, targetPath, expectedSha256 }
          : { mode: "signature" as const, manifestPath, signaturePath, publicKeyPem };

      const payload = {
        name,
        repoUrl: repoUrl || undefined,
        branch,
        subdirectory: subdirectory || undefined,
        runtimeKind,
        transportType,
        installCommand: transportType === "stdio" || isolationMode === "docker" ? installCommand : undefined,
        buildCommand: transportType === "stdio" || isolationMode === "docker" ? buildCommand : undefined,
        startCommand: transportType === "stdio" ? startCommand : undefined,
        remoteUrl: transportType === "streamable-http" ? remoteUrl : undefined,
        targetNodeId,
        isolation: { mode: isolationMode, dockerImage: isolationMode === "docker" ? dockerImage : undefined },
        packageVerification,
        env
      };

      if (editingServer && onUpdate) {
        await onUpdate(editingServer.id, payload);
      } else {
        await onCreate({ id: effectiveId, ...payload });
        resetForm();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="section-header compact">
        <div>
          <h2>{editingServer ? "Edit MCP Server" : "Add MCP Server"}</h2>
          <p className="muted">Registry, isolation, and verification controls</p>
        </div>
      </div>

      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label>
        Generated ID
        <input value={effectiveId} readOnly />
      </label>

      <label>
        GitHub Repo URL
        <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/org/repo" />
      </label>

      <div className="grid-two">
        <label>
          Branch
          <input value={branch} onChange={(event) => setBranch(event.target.value)} />
        </label>

        <label>
          Subdirectory
          <input
            value={subdirectory}
            onChange={(event) => setSubdirectory(event.target.value)}
            placeholder="e.g. src/dbtools-mcp-server"
          />
        </label>
      </div>

      <div className="grid-two">
        <label>
          Target Node
          <input value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} />
        </label>
      </div>

      <div className="grid-two">
        <label>
          Runtime
          <select value={runtimeKind} onChange={(event) => setRuntimeKind(event.target.value as RuntimeKind)}>
            <option value="node">node</option>
            <option value="python">python</option>
            <option value="docker">docker</option>
            <option value="remote">remote</option>
          </select>
        </label>

        <label>
          Transport
          <select value={transportType} onChange={(event) => setTransportType(event.target.value as TransportType)}>
            <option value="stdio">stdio</option>
            <option value="streamable-http">streamable-http</option>
          </select>
        </label>
      </div>

      <div className="grid-two">
        <label>
          Isolation
          <select value={isolationMode} onChange={(event) => setIsolationMode(event.target.value as IsolationMode)}>
            <option value="process">process</option>
            <option value="docker">docker</option>
          </select>
        </label>

        {isolationMode === "docker" && (
          <label>
            Docker Image
            <input value={dockerImage} onChange={(event) => setDockerImage(event.target.value)} />
          </label>
        )}
      </div>

      {transportType === "stdio" && (
        <>
          <label>
            Install Command
            <input value={installCommand} onChange={(event) => setInstallCommand(event.target.value)} />
          </label>

          <label>
            Build Command
            <input value={buildCommand} onChange={(event) => setBuildCommand(event.target.value)} />
          </label>

          <label>
            Start Command
            <input value={startCommand} onChange={(event) => setStartCommand(event.target.value)} />
          </label>
        </>
      )}

      {transportType === "streamable-http" && (
        <label>
          Remote MCP URL
          <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://example.com/mcp" />
        </label>
      )}

      <label>
        Package Verification
        <select value={verificationMode} onChange={(event) => setVerificationMode(event.target.value as VerificationMode)}>
          <option value="none">none</option>
          <option value="checksum">checksum</option>
          <option value="signature">signature</option>
        </select>
      </label>

      {verificationMode === "checksum" && (
        <div className="grid-two">
          <label>
            Target File
            <input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
          </label>
          <label>
            Expected SHA-256
            <input value={expectedSha256} onChange={(event) => setExpectedSha256(event.target.value)} />
          </label>
        </div>
      )}

      {verificationMode === "signature" && (
        <>
          <div className="grid-two">
            <label>
              Manifest Path
              <input value={manifestPath} onChange={(event) => setManifestPath(event.target.value)} />
            </label>
            <label>
              Signature Path
              <input value={signaturePath} onChange={(event) => setSignaturePath(event.target.value)} />
            </label>
          </div>
          <label>
            Public Key PEM
            <textarea rows={4} value={publicKeyPem} onChange={(event) => setPublicKeyPem(event.target.value)} />
          </label>
        </>
      )}

      <label>
        Environment Variables (KEY=value)
        <textarea rows={6} value={envText} onChange={(event) => setEnvText(event.target.value)} />
      </label>

      <div className="button-row">
        <button className="primary" type="submit" disabled={!effectiveId || saving}>
          {saving ? "Saving..." : editingServer ? "Update Server" : "Create Server"}
        </button>
        {editingServer && (
          <button
            type="button"
            onClick={() => {
              onCancelEdit?.();
            }}
          >
            Cancel Edit
          </button>
        )}
      </div>
    </form>
  );
}

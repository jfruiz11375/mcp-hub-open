export type ServerStatus = "draft" | "stopped" | "starting" | "running" | "error";
export type RuntimeKind = "node" | "python" | "docker" | "remote";
export type TransportType = "stdio" | "streamable-http";
export type IsolationMode = "process" | "docker";
export type VerificationMode = "none" | "checksum" | "signature";

export interface EnvVarField {
  key: string;
  value: string;
  secret?: boolean;
}

export interface IsolationConfig {
  mode: IsolationMode;
  dockerImage?: string;
  dockerNetwork?: string;
}

export interface PackageVerification {
  mode: VerificationMode;
  targetPath?: string;
  expectedSha256?: string;
  manifestPath?: string;
  signaturePath?: string;
  publicKeyPem?: string;
}

export interface ManagedServer {
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
  workingDirectory?: string;
  remoteUrl?: string;
  env: EnvVarField[];
  status: ServerStatus;
  createdAt: string;
  updatedAt: string;
  installedPath?: string;
  pid?: number;
  lastInstalledAt?: string;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
  targetNodeId?: string;
  isolation?: IsolationConfig;
  packageVerification?: PackageVerification;
}

export interface RegistryFile {
  servers: ManagedServer[];
}

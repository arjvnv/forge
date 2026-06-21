export type BuildStage =
  | 'routing'
  | 'reuse'
  | 'gap'
  | 'synthesizing'
  | 'synthesized'
  | 'verifying'
  | 'verified'
  | 'approved'
  | 'executing'
  | 'installed'
  | 'done'
  | 'error'
  | 'verify_failed'
  | 'timeout';

export interface BuildEvent {
  stage: BuildStage;
  message: string;
  payload: Record<string, unknown>;
}

export interface BuiltFrom {
  id: string;
  name: string;
  similarity: number;
}

export interface Manifest {
  id: string;
  name: string;
  description: string;
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  reads: string[];
  actions?: string[];
  scope?: Record<string, unknown>;
  reuse_count: number;
  created_at: string;
  built_from?: BuiltFrom[];
}

export interface UiSpec {
  type: string;
  columns: string[];
  title: string;
}

export interface Capability {
  manifest: Manifest;
  logic: string;
  ui_spec: UiSpec;
  verified: boolean;
}

export type ResultRow = Record<string, unknown>;

export interface ExecutionResult {
  rows: ResultRow[];
  count: number;
  latency_ms: number;
}

export interface HealthStatus {
  status: string;
  redis: boolean;
  postgres: boolean;
}

// Local type mirror of backend/schemas.py. Intentionally NOT imported from
// shell/ — this app is standalone. Keep small; only the fields we render.

export interface BuildTraceStep {
  stage: string;
  ts: number;
  detail: string;
}

export interface Verification {
  data_calls?: number;
  imports?: number;
  dunders?: number;
  methods?: string[];
  sandbox_valid?: boolean;
  all_on_allowlist?: boolean;
}

export interface Provenance {
  build_cost: number;
  input_tokens: number;
  output_tokens: number;
  trace: BuildTraceStep[];
  verification: Verification;
  first_run_ms: number;
  best_similarity: number | null;
}

export interface Manifest {
  id: string;
  name: string;
  description: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  reads: string[];
  actions: string[];
  scope: Record<string, unknown>;
  reuse_count: number;
  created_at: string;
  built_from: Array<Record<string, unknown>>;
  provenance: Provenance | null;
}

export interface Capability {
  manifest: Manifest;
  logic: string;
  ui_spec: Record<string, unknown>;
  verified: boolean;
}

export interface StreamEvent {
  id: string;
  capability_id: string;
  stage: string;
  message: string;
  payload: Record<string, unknown>;
  ts: number;
}

export interface Health {
  status?: string;
  redis: boolean;
  postgres: boolean;
  reachable: boolean;
}

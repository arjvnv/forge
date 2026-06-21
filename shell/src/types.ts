export type BuildStage =
  | 'routing'
  | 'reuse'
  | 'gap'
  | 'synthesizing'
  | 'synthesized'
  | 'verifying'
  | 'verified'
  | 'approved'
  | 'installed'
  | 'executing'
  | 'done'
  | 'verify_failed'
  | 'error'
  | 'timeout';

export interface BuildEvent {
  stage: BuildStage;
  message: string;
  payload: Record<string, unknown>;
}

export interface Manifest {
  id: string;
  name: string;
  description: string;
  reuse_count: number;
  created_at: string;
}

export type ResultRow = Record<string, unknown>;

export interface ExecutionResult {
  rows: ResultRow[];
  count: number;
  columns?: string[];
}

export type AppState =
  | 'idle'
  | 'building'
  | 'awaiting_approval'
  | 'done'
  | 'error';

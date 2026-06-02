export interface CcbdStartOptions {
  autoPermission?: boolean;
  restore?: boolean;
  terminalSize?: {
    width: number;
    height: number;
  };
}

export interface CcbdStartResponse {
  started?: string[];
  socketPath?: string;
  raw?: Record<string, unknown>;
}

export interface CcbdSubmitInput {
  anchorId?: string;
  toAgent: string;
  taskId: string;
  body: string;
  fromActor?: string;
  messageType?: string;
}

export interface CcbdSubmitResponse {
  jobId: string;
  submissionId?: string | null;
  traceRef?: string | null;
  raw?: Record<string, unknown>;
}

export interface CcbdProjectView {
  schema_version?: number;
  project?: {
    id?: string;
    root?: string;
    display_name?: string;
  };
  namespace?: {
    socket_path?: string | null;
    session_name?: string | null;
    active_window?: string | null;
    active_pane_id?: string | null;
  };
  windows?: Array<{
    name?: string;
    agents?: string[];
  }>;
  agents?: Array<{
    name?: string;
    provider?: string;
    window?: string;
    pane_id?: string | null;
    active?: boolean;
  }>;
}

export interface CcbdClientServiceLike {
  start(agentNames: string[], opts?: CcbdStartOptions): Promise<CcbdStartResponse>;
  submit(input: CcbdSubmitInput): Promise<CcbdSubmitResponse>;
  cancel(jobId: string, opts?: CcbdAnchorRequestOptions): Promise<Record<string, unknown>>;
  get(jobId: string, opts?: CcbdAnchorRequestOptions): Promise<Record<string, unknown>>;
  queue(target: string, opts?: CcbdAnchorRequestOptions): Promise<Record<string, unknown>>;
  trace(target: string, opts?: CcbdAnchorRequestOptions): Promise<Record<string, unknown>>;
  ping(target?: string): Promise<Record<string, unknown>>;
  projectView(): Promise<CcbdProjectView>;
}

export interface CcbdAnchorRequestOptions {
  anchorId?: string;
}

export interface CcbdAnchorSocketInfo {
  socketPath?: string | null;
  anchorPath?: string | null;
  projectId?: string | null;
}

export type CcbdAnchorSocketResolver = (anchorId: string) => Promise<CcbdAnchorSocketInfo | null>;

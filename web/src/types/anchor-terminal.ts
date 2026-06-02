export interface AnchorTerminalPaneView {
  name: string;
  title: string;
  currentCommand: string;
  active: boolean;
  cols: number;
  rows: number;
}

export interface AnchorTerminalRecordingMetaView {
  id: string;
  anchorId: string;
  taskId: string | null;
  pane: string;
  source: "anchor";
  cols: number;
  rows: number;
  createdAt: string;
  finishedAt: string | null;
  byteSize: number;
}

export interface AnchorTerminalRecordingPayload {
  meta: AnchorTerminalRecordingMetaView;
  cast: string;
}

export interface AnchorNativeTerminalSpawnResult {
  spawned: boolean;
  attempted: string[];
  reason?: string;
  fallbackCommand: string;
  sessionName: string;
  socketPath: string;
  anchorPath: string;
}

export interface AnchorTerminalWriterStatus {
  hasWriter: boolean;
  isYou: boolean;
  since?: string;
}

export interface AnchorTerminalReadyDescriptor {
  anchorId: string;
  taskId: string | null;
  pane: string;
  source: "anchor";
  readonly: true;
  recordingId: string;
  attachedSocketCount: number;
  writer?: AnchorTerminalWriterStatus;
}

export interface AnchorTerminalLeaseDeniedDetail {
  currentHolder: { clientId: string; since: string };
}

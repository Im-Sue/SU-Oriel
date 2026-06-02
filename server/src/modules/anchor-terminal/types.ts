import type { EventEmitter } from "node:events";

export interface AnchorTerminalAnchor {
  anchorId: string;
  anchorPath: string;
  taskId: string | null;
  state: string;
}

export interface AnchorTerminalPane {
  name: string;
  paneId: string;
  title: string;
  currentCommand: string;
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  active: boolean;
  cols: number;
  rows: number;
}

export interface PublicAnchorTerminalPane {
  name: string;
  title: string;
  currentCommand: string;
  active: boolean;
  cols: number;
  rows: number;
}

export interface AnchorTerminalTmuxBackend {
  listPanes(anchor: Pick<AnchorTerminalAnchor, "anchorPath">): Promise<AnchorTerminalPane[]>;
  capturePane(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane): Promise<string>;
  captureFrame(
    anchor: Pick<AnchorTerminalAnchor, "anchorPath">,
    pane: AnchorTerminalPane
  ): Promise<{ data: string; cols: number; rows: number }>;
  startPipe(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane, outputPath: string): Promise<void>;
  stopPipe(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane): Promise<void>;
  getWindowLayout(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, sessionName: string): Promise<string>;
  resizeWindow(
    anchor: Pick<AnchorTerminalAnchor, "anchorPath">,
    sessionName: string,
    cols: number,
    rows: number
  ): Promise<void>;
  zoomPane(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane): Promise<void>;
  unzoomPane(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane): Promise<void>;
  restoreLayout(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, sessionName: string, layout: string): Promise<void>;
  resizePane?(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane, cols: number, rows: number): Promise<void>;
  getPaneSize?(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane): Promise<{ cols: number; rows: number }>;
  sendKeysLiteral(anchor: Pick<AnchorTerminalAnchor, "anchorPath">, pane: AnchorTerminalPane, data: string): Promise<void>;
}

export interface PipeOutputSource {
  onData(handler: (chunk: string) => void): void;
  onError(handler: (error: Error) => void): void;
  close(): Promise<void>;
}

export interface AnchorTerminalAttachResult {
  descriptor: {
    anchorId: string;
    taskId: string | null;
    pane: string;
    source: "anchor";
    readonly: true;
    recordingId: string;
    attachedSocketCount: number;
    writer: {
      hasWriter: boolean;
      isYou: boolean;
      since?: string;
    };
  };
  snapshot: string;
  bufferTail: string;
  emitter: EventEmitter;
  lastFrame: AnchorTerminalFrameEvent | null;
}

export interface AnchorTerminalViewportAppliedEvent {
  anchorId: string;
  pane: string;
  cols: number;
  rows: number;
}

export interface AnchorTerminalOutputEvent {
  anchorId: string;
  pane: string;
  data: string;
}

export interface AnchorTerminalFrameEvent {
  anchorId: string;
  pane: string;
  data: string;
  cols: number;
  rows: number;
  generation: number;
}

export interface AnchorTerminalExitEvent {
  anchorId: string;
  pane: string;
  reason: string;
}

export interface AnchorTerminalLeaseChangedEvent {
  anchorId: string;
  pane: string;
  hasWriter: boolean;
  holderClientId?: string;
  since?: string;
}

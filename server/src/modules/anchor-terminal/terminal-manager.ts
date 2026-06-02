import { EventEmitter } from "node:events";

import { AnchorTerminalAuditWriter, type AnchorTerminalAuditInput } from "./audit-writer.js";
import { AnchorTerminalRecordingStore, type AnchorTerminalRecordingSession } from "./recording-store.js";
import { TmuxAnchorTerminalService } from "./tmux.service.js";
import { FileTailPipeOutputSource } from "./file-tail-source.js";
import type {
  AnchorTerminalAnchor,
  AnchorTerminalAttachResult,
  AnchorTerminalExitEvent,
  AnchorTerminalFrameEvent,
  AnchorTerminalLeaseChangedEvent,
  AnchorTerminalPane,
  AnchorTerminalTmuxBackend,
  PipeOutputSource,
  PublicAnchorTerminalPane
} from "./types.js";

const VIEWPORT_DEBOUNCE_MS = 200;
const DEFAULT_MIRROR_INTERVAL_MS = 200;
const MIN_MIRROR_INTERVAL_MS = 100;
const MAX_MIRROR_INTERVAL_MS = 500;

export class AnchorTerminalError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "AnchorTerminalError";
  }
}

export interface AnchorTerminalManagerOptions {
  tmux?: AnchorTerminalTmuxBackend;
  recordingStore?: AnchorTerminalRecordingStore;
  auditWriter?: AnchorTerminalAuditSink;
  anchorResolver: (anchorId: string) => Promise<AnchorTerminalAnchor | null>;
  openPipeOutput?: (path: string) => Promise<PipeOutputSource>;
  healthCheckIntervalMs?: number;
  mirrorIntervalMs?: number | string;
}

export interface AnchorTerminalAuditSink {
  recordInput(input: AnchorTerminalAuditInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface TerminalStream {
  key: string;
  anchor: AnchorTerminalAnchor;
  pane: AnchorTerminalPane;
  emitter: EventEmitter;
  clients: Set<string>;
  outputSource: PipeOutputSource;
  recording: AnchorTerminalRecordingSession;
  healthTimer: NodeJS.Timeout | null;
  mirrorTimer: NodeJS.Timeout | null;
  mirrorInFlight: boolean;
  mirrorGeneration: number;
  lastFrameKey: string | null;
  lastFrame: AnchorTerminalFrameEvent | null;
  closed: boolean;
}

interface ViewportRequest {
  clientId: string;
  pane: AnchorTerminalPane;
  cols: number;
  rows: number;
  active: boolean;
  sequence: number;
}

interface ViewportLease {
  anchor: AnchorTerminalAnchor;
  sessionName: string;
  originalLayout: string;
  zoomedPane: AnchorTerminalPane | null;
  timer: NodeJS.Timeout | null;
  latest: ViewportRequest | null;
}

interface LeaseRecord {
  clientId: string;
  grantedAt: string;
}

export type WriterLeaseRequestResult =
  | { granted: true; lease: { clientId: string; since: string } }
  | { granted: false; currentHolder: { clientId: string; since: string } };

export class AnchorTerminalManager {
  private readonly tmux: AnchorTerminalTmuxBackend;
  private readonly recordingStore: AnchorTerminalRecordingStore;
  private readonly auditWriter: AnchorTerminalAuditSink;
  private readonly anchorResolver: (anchorId: string) => Promise<AnchorTerminalAnchor | null>;
  private readonly openPipeOutput: (path: string) => Promise<PipeOutputSource>;
  private readonly healthCheckIntervalMs: number;
  private readonly mirrorIntervalMs: number;
  private readonly streams = new Map<string, TerminalStream>();
  private readonly writerLeases = new Map<string, LeaseRecord>();
  private readonly viewportLeases = new Map<string, ViewportLease>();
  private readonly viewportClients = new Map<string, Map<string, ViewportRequest>>();
  private viewportSequence = 0;

  constructor(options: AnchorTerminalManagerOptions) {
    this.tmux = options.tmux ?? new TmuxAnchorTerminalService();
    this.recordingStore = options.recordingStore ?? new AnchorTerminalRecordingStore();
    this.auditWriter = options.auditWriter ?? new AnchorTerminalAuditWriter();
    this.anchorResolver = options.anchorResolver;
    this.openPipeOutput = options.openPipeOutput ?? (async (path) => await FileTailPipeOutputSource.open(path));
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 5_000;
    this.mirrorIntervalMs = normalizeMirrorIntervalMs(
      options.mirrorIntervalMs ?? process.env.CCB_ANCHOR_TERMINAL_MIRROR_INTERVAL_MS
    );
  }

  async listPanes(anchorId: string): Promise<PublicAnchorTerminalPane[]> {
    const anchor = await this.resolveActiveAnchor(anchorId);
    const panes = await this.tmux.listPanes(anchor);
    return panes.map(toPublicPane);
  }

  async attach(input: {
    anchorId: string;
    paneName: string;
    clientId: string;
  }): Promise<AnchorTerminalAttachResult> {
    const anchor = await this.resolveActiveAnchor(input.anchorId);
    const key = streamKey(input.anchorId, input.paneName);
    let stream = this.streams.get(key);
    if (!stream || stream.closed) {
      const pane = await this.resolvePane(anchor, input.paneName);
      stream = await this.createStream(anchor, pane);
      this.streams.set(key, stream);
    }
    stream.clients.add(input.clientId);
    return {
      descriptor: {
        anchorId: anchor.anchorId,
        taskId: anchor.taskId,
        pane: stream.pane.name,
        source: "anchor",
        readonly: true,
        recordingId: stream.recording.meta.id,
        attachedSocketCount: stream.clients.size,
        writer: this.writerDescriptor(key, input.clientId)
      },
      snapshot: "",
      bufferTail: "",
      emitter: stream.emitter,
      lastFrame: stream.lastFrame
    };
  }

  detach(anchorId: string, paneName: string, clientId: string): void {
    const stream = this.streams.get(streamKey(anchorId, paneName));
    this.releaseWriterLease(anchorId, paneName, clientId);
    stream?.clients.delete(clientId);
    this.forgetViewportClient(anchorId, clientId);
    void this.reconcileViewportLease(anchorId);
  }

  requestWriterLease(anchorId: string, paneName: string, clientId: string): WriterLeaseRequestResult {
    const stream = this.requireAttachedStream(anchorId, paneName, clientId);
    const key = stream.key;
    const existing = this.writerLeases.get(key);
    if (existing) {
      if (existing.clientId === clientId) {
        return {
          granted: true,
          lease: {
            clientId: existing.clientId,
            since: existing.grantedAt
          }
        };
      }
      return {
        granted: false,
        currentHolder: {
          clientId: existing.clientId,
          since: existing.grantedAt
        }
      };
    }
    const lease: LeaseRecord = {
      clientId,
      grantedAt: new Date().toISOString()
    };
    this.writerLeases.set(key, lease);
    this.emitLeaseChanged(stream);
    return {
      granted: true,
      lease: {
        clientId: lease.clientId,
        since: lease.grantedAt
      }
    };
  }

  releaseWriterLease(anchorId: string, paneName: string, clientId: string): boolean {
    const key = streamKey(anchorId, paneName);
    const lease = this.writerLeases.get(key);
    if (!lease || lease.clientId !== clientId) {
      return false;
    }
    this.writerLeases.delete(key);
    const stream = this.streams.get(key);
    if (stream && !stream.closed) {
      this.emitLeaseChanged(stream);
    }
    return true;
  }

  async applyInput(input: {
    anchorId: string;
    paneName: string;
    clientId: string;
    remoteAddr: string;
    data: string;
  }): Promise<void> {
    if (!input.data) {
      return;
    }
    const stream = this.requireAttachedStream(input.anchorId, input.paneName, input.clientId);
    this.assertWriterLease(stream, input.clientId);
    try {
      await this.tmux.sendKeysLiteral(stream.anchor, stream.pane, input.data);
    } catch (error) {
      throw new AnchorTerminalError(
        "INPUT_SEND_FAILED",
        error instanceof Error ? error.message : "tmux send-keys failed",
        502
      );
    }
    this.auditWriter.recordInput({
      anchorId: input.anchorId,
      pane: stream.pane.name,
      clientId: input.clientId,
      remoteAddr: input.remoteAddr,
      data: input.data
    });
  }

  async applyWriteResize(input: {
    anchorId: string;
    paneName: string;
    clientId: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    const stream = this.requireAttachedStream(input.anchorId, input.paneName, input.clientId);
    this.assertWriterLease(stream, input.clientId);
    await this.applyViewport({
      anchorId: input.anchorId,
      paneName: input.paneName,
      clientId: input.clientId,
      cols: input.cols,
      rows: input.rows,
      active: true
    });
  }

  async applyViewport(input: {
    anchorId: string;
    paneName: string;
    clientId: string;
    cols: number;
    rows: number;
    active: boolean;
  }): Promise<void> {
    const stream = this.streams.get(streamKey(input.anchorId, input.paneName));
    if (!stream || stream.closed || !stream.clients.has(input.clientId)) {
      return;
    }

    const lease = await this.ensureViewportLease(stream.anchor, stream.pane);
    const request: ViewportRequest = {
      clientId: input.clientId,
      pane: stream.pane,
      cols: input.cols,
      rows: input.rows,
      active: input.active,
      sequence: ++this.viewportSequence
    };
    let requests = this.viewportClients.get(input.anchorId);
    if (!requests) {
      requests = new Map();
      this.viewportClients.set(input.anchorId, requests);
    }
    requests.set(input.clientId, request);
    if (!request.active) {
      await this.reconcileViewportLease(input.anchorId);
      return;
    }
    this.scheduleViewportApply(lease, this.latestActiveViewport(input.anchorId));
  }

  async closeStream(anchorId: string, paneName: string, reason: string): Promise<void> {
    const stream = this.streams.get(streamKey(anchorId, paneName));
    if (!stream) {
      return;
    }
    await this.closeTerminalStream(stream, reason);
  }

  async closeAnchor(anchorId: string, reason: string): Promise<void> {
    const streams = [...this.streams.values()].filter((stream) => stream.anchor.anchorId === anchorId);
    await Promise.all(streams.map((stream) => this.closeTerminalStream(stream, reason)));
  }

  private async createStream(anchor: AnchorTerminalAnchor, pane: AnchorTerminalPane): Promise<TerminalStream> {
    const outputPath = this.recordingStore.pipeOutputPath(anchor.anchorId, pane.name);
    const outputSource = await this.openPipeOutput(outputPath);
    const recording = this.recordingStore.start({
      anchorId: anchor.anchorId,
      taskId: anchor.taskId,
      pane: pane.name,
      cols: pane.cols,
      rows: pane.rows
    });
    const stream: TerminalStream = {
      key: streamKey(anchor.anchorId, pane.name),
      anchor,
      pane,
      emitter: new EventEmitter(),
      clients: new Set(),
      outputSource,
      recording,
      healthTimer: null,
      mirrorTimer: null,
      mirrorInFlight: false,
      mirrorGeneration: 0,
      lastFrameKey: null,
      lastFrame: null,
      closed: false
    };

    outputSource.onData((chunk) => this.recordRecordingOutput(stream, chunk));
    outputSource.onError((error) => {
      void this.closeTerminalStream(stream, error.message || "pipe output error");
    });
    try {
      await this.tmux.startPipe(anchor, pane, outputPath);
    } catch (error) {
      await outputSource.close().catch(() => undefined);
      await recording.close().catch(() => undefined);
      throw error;
    }
    stream.healthTimer = setInterval(() => {
      void this.checkStreamHealth(stream);
    }, this.healthCheckIntervalMs);
    stream.healthTimer.unref?.();
    stream.mirrorTimer = setInterval(() => {
      void this.captureMirrorFrame(stream);
    }, this.mirrorIntervalMs);
    stream.mirrorTimer.unref?.();
    return stream;
  }

  private recordRecordingOutput(stream: TerminalStream, chunk: string): void {
    if (stream.closed || !chunk) {
      return;
    }
    stream.recording.writeOutput(chunk);
  }

  private async captureMirrorFrame(stream: TerminalStream): Promise<void> {
    if (stream.closed || stream.mirrorInFlight) {
      return;
    }
    stream.mirrorInFlight = true;
    try {
      const frame = await this.tmux.captureFrame(stream.anchor, stream.pane);
      if (stream.closed) {
        return;
      }
      const frameKey = `${frame.cols}x${frame.rows}\u0000${frame.data}`;
      if (frameKey === stream.lastFrameKey) {
        return;
      }
      stream.lastFrameKey = frameKey;
      const event: AnchorTerminalFrameEvent = {
        anchorId: stream.anchor.anchorId,
        pane: stream.pane.name,
        data: frame.data,
        cols: frame.cols,
        rows: frame.rows,
        generation: ++stream.mirrorGeneration
      };
      stream.lastFrame = event;
      stream.emitter.emit("frame", event);
    } catch (error) {
      await this.closeTerminalStream(stream, error instanceof Error ? error.message : "anchor terminal mirror failed");
    } finally {
      stream.mirrorInFlight = false;
    }
  }

  private async closeTerminalStream(stream: TerminalStream, reason: string): Promise<void> {
    if (stream.closed) {
      return;
    }
    stream.closed = true;
    this.streams.delete(stream.key);
    this.releaseWriterLeaseForStream(stream);
    for (const clientId of stream.clients) {
      this.forgetViewportClient(stream.anchor.anchorId, clientId);
    }
    if (stream.healthTimer) {
      clearInterval(stream.healthTimer);
      stream.healthTimer = null;
    }
    if (stream.mirrorTimer) {
      clearInterval(stream.mirrorTimer);
      stream.mirrorTimer = null;
    }
    await this.tmux.stopPipe(stream.anchor, stream.pane).catch(() => undefined);
    await stream.outputSource.close().catch(() => undefined);
    await stream.recording.close().catch(() => undefined);
    const event: AnchorTerminalExitEvent = {
      anchorId: stream.anchor.anchorId,
      pane: stream.pane.name,
      reason
    };
    stream.emitter.emit("exit", event);
    stream.emitter.removeAllListeners();
    stream.clients.clear();
    await this.reconcileViewportLease(stream.anchor.anchorId);
  }

  private requireAttachedStream(anchorId: string, paneName: string, clientId: string): TerminalStream {
    const stream = this.streams.get(streamKey(anchorId, paneName));
    if (!stream || stream.closed || !stream.clients.has(clientId)) {
      throw new AnchorTerminalError("CLIENT_NOT_ATTACHED", "anchor terminal client is not attached", 409);
    }
    return stream;
  }

  private assertWriterLease(stream: TerminalStream, clientId: string): void {
    const lease = this.writerLeases.get(stream.key);
    if (!lease || lease.clientId !== clientId) {
      throw new AnchorTerminalError("WRITER_LEASE_REQUIRED", "writer lease required for anchor terminal input", 409);
    }
  }

  private writerDescriptor(key: string, clientId: string): { hasWriter: boolean; isYou: boolean; since?: string } {
    const lease = this.writerLeases.get(key);
    if (!lease) {
      return { hasWriter: false, isYou: false };
    }
    return {
      hasWriter: true,
      isYou: lease.clientId === clientId,
      since: lease.grantedAt
    };
  }

  private releaseWriterLeaseForStream(stream: TerminalStream): void {
    if (!this.writerLeases.has(stream.key)) {
      return;
    }
    this.writerLeases.delete(stream.key);
    this.emitLeaseChanged(stream);
  }

  private emitLeaseChanged(stream: TerminalStream): void {
    const lease = this.writerLeases.get(stream.key);
    const event: AnchorTerminalLeaseChangedEvent = {
      anchorId: stream.anchor.anchorId,
      pane: stream.pane.name,
      hasWriter: Boolean(lease),
      holderClientId: lease?.clientId,
      since: lease?.grantedAt
    };
    stream.emitter.emit("lease_changed", event);
  }

  private async ensureViewportLease(anchor: AnchorTerminalAnchor, pane: AnchorTerminalPane): Promise<ViewportLease> {
    const existing = this.viewportLeases.get(anchor.anchorId);
    if (existing) {
      return existing;
    }
    const originalLayout = await this.tmux.getWindowLayout(anchor, pane.sessionName);
    const lease: ViewportLease = {
      anchor,
      sessionName: pane.sessionName,
      originalLayout,
      zoomedPane: null,
      timer: null,
      latest: null
    };
    this.viewportLeases.set(anchor.anchorId, lease);
    return lease;
  }

  private scheduleViewportApply(lease: ViewportLease, request: ViewportRequest | null): void {
    if (!request) {
      lease.latest = null;
      if (lease.timer) {
        clearTimeout(lease.timer);
        lease.timer = null;
      }
      return;
    }
    lease.latest = request;
    if (lease.timer) {
      clearTimeout(lease.timer);
    }
    lease.timer = setTimeout(() => {
      lease.timer = null;
      void this.applyViewportLease(lease.anchor.anchorId).catch(() => undefined);
    }, VIEWPORT_DEBOUNCE_MS);
    lease.timer.unref?.();
  }

  private async applyViewportLease(anchorId: string): Promise<void> {
    const lease = this.viewportLeases.get(anchorId);
    if (!lease) return;
    const requests = [...(this.viewportClients.get(anchorId)?.values() ?? [])];
    if (requests.length === 0) return;

    // 检测是否有"多 pane split"诉求：不同 pane 都标 active=true 或 active=false
    // 都进入"并排显示"模式（unzoom + 保留原 layout + resize-window 到最大）。
    // 单 pane active=true 仍是 zoom 模式（TA8a 行为）。
    const activeRequests = requests.filter((r) => r.active);
    // split mode 触发条件：所有 viewport 都标 active=false（前端 hint
    // "我在并排显示，不要 zoom，让 split layout 自然展开"）。多 client
    // 多 active=true 仍走 TA8a 原 zoom 切换路径（last-active wins）。
    const isSplitMode = activeRequests.length === 0 && requests.length > 0;

    // resize-window 取所有 viewport 中最大的 cols/rows
    const maxCols = Math.max(...requests.map((r) => r.cols));
    const maxRows = Math.max(...requests.map((r) => r.rows));
    await this.tmux.resizeWindow(lease.anchor, lease.sessionName, maxCols, maxRows);

    if (isSplitMode) {
      // 多 pane 并排：unzoom + 让 split layout 自然展开
      if (lease.zoomedPane) {
        await this.tmux.unzoomPane(lease.anchor, lease.zoomedPane).catch(() => undefined);
        lease.zoomedPane = null;
      }
    } else {
      // 单 pane zoom 模式（TA8a 原行为）— 取 sequence 最高的 active request
      const request = [...activeRequests].sort((a, b) => b.sequence - a.sequence)[0];
      lease.latest = request;
      const previousPane = lease.zoomedPane;
      if (previousPane && previousPane.paneId !== request.pane.paneId) {
        await this.tmux.unzoomPane(lease.anchor, previousPane).catch(() => undefined);
        lease.zoomedPane = null;
      }
      if (!lease.zoomedPane || lease.zoomedPane.paneId !== request.pane.paneId) {
        await this.tmux.zoomPane(lease.anchor, request.pane);
        lease.zoomedPane = request.pane;
      }
    }

    // 查询 tmux 实际给的 pane size 并广播给对应 stream（TA9 双向同步）。
    // split mode 下要给所有相关 pane 都 broadcast 实际 size。
    if (this.tmux.getPaneSize) {
      const paneIds = new Set<string>();
      const panesToReport = isSplitMode
        ? requests.filter((r) => {
            if (paneIds.has(r.pane.paneId)) return false;
            paneIds.add(r.pane.paneId);
            return true;
          })
        : [{ pane: lease.zoomedPane ?? requests[requests.length - 1].pane }];
      for (const item of panesToReport) {
        const pane = "pane" in item ? item.pane : item;
        if (!pane) continue;
        try {
          const actual = await this.tmux.getPaneSize(lease.anchor, pane);
          const stream = this.streams.get(streamKey(anchorId, pane.name));
          if (stream && !stream.closed) {
            stream.emitter.emit("viewport_applied", {
              anchorId,
              pane: pane.name,
              cols: actual.cols,
              rows: actual.rows
            });
          }
        } catch {
          // best-effort
        }
      }
    }
  }

  private async reconcileViewportLease(anchorId: string): Promise<void> {
    if (!this.hasAttachedClients(anchorId)) {
      await this.restoreViewportLease(anchorId);
      return;
    }
    const lease = this.viewportLeases.get(anchorId);
    if (lease) {
      this.scheduleViewportApply(lease, this.latestActiveViewport(anchorId));
    }
  }

  private async restoreViewportLease(anchorId: string): Promise<void> {
    const lease = this.viewportLeases.get(anchorId);
    if (!lease) {
      this.viewportClients.delete(anchorId);
      return;
    }
    this.viewportLeases.delete(anchorId);
    this.viewportClients.delete(anchorId);
    if (lease.timer) {
      clearTimeout(lease.timer);
      lease.timer = null;
    }
    await this.tmux.restoreLayout(lease.anchor, lease.sessionName, lease.originalLayout).catch(() => undefined);
  }

  private latestActiveViewport(anchorId: string): ViewportRequest | null {
    const requests = this.viewportClients.get(anchorId);
    if (!requests) {
      return null;
    }
    let latest: ViewportRequest | null = null;
    for (const request of requests.values()) {
      if (!request.active) {
        continue;
      }
      if (!latest || request.sequence > latest.sequence) {
        latest = request;
      }
    }
    return latest;
  }

  private forgetViewportClient(anchorId: string, clientId: string): void {
    const requests = this.viewportClients.get(anchorId);
    requests?.delete(clientId);
    if (requests && requests.size === 0) {
      this.viewportClients.delete(anchorId);
    }
  }

  private hasAttachedClients(anchorId: string): boolean {
    return [...this.streams.values()].some((stream) => {
      if (stream.anchor.anchorId !== anchorId || stream.closed) {
        return false;
      }
      return stream.clients.size > 0;
    });
  }

  private async checkStreamHealth(stream: TerminalStream): Promise<void> {
    if (stream.closed) {
      return;
    }
    try {
      const anchor = await this.anchorResolver(stream.anchor.anchorId);
      if (!anchor || anchor.state === "destroyed") {
        await this.closeTerminalStream(stream, "anchor destroyed");
        return;
      }
      const panes = await this.tmux.listPanes(anchor);
      const paneStillExists = panes.some((pane) => pane.paneId === stream.pane.paneId || pane.name === stream.pane.name);
      if (!paneStillExists) {
        await this.closeTerminalStream(stream, "anchor pane offline");
      }
    } catch (error) {
      await this.closeTerminalStream(stream, error instanceof Error ? error.message : "anchor terminal offline");
    }
  }

  private async resolveActiveAnchor(anchorId: string): Promise<AnchorTerminalAnchor> {
    const anchor = await this.anchorResolver(anchorId);
    if (!anchor || anchor.state === "destroyed") {
      throw new AnchorTerminalError("ANCHOR_NOT_FOUND", "anchor 不存在或已销毁", 404);
    }
    return anchor;
  }

  private async resolvePane(anchor: AnchorTerminalAnchor, paneName: string): Promise<AnchorTerminalPane> {
    const panes = await this.tmux.listPanes(anchor);
    const pane = panes.find((item) =>
      item.name === paneName ||
      item.title === paneName ||
      item.currentCommand === paneName ||
      item.paneId === paneName
    );
    if (!pane) {
      throw new AnchorTerminalError("PANE_NOT_FOUND", `anchor pane 不存在：${paneName}`, 404);
    }
    return pane;
  }
}

function streamKey(anchorId: string, paneName: string): string {
  return `${anchorId}:${paneName}`;
}

function toPublicPane(pane: AnchorTerminalPane): PublicAnchorTerminalPane {
  return {
    name: pane.name,
    title: pane.title,
    currentCommand: pane.currentCommand,
    active: pane.active,
    cols: pane.cols,
    rows: pane.rows
  };
}

function normalizeMirrorIntervalMs(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MIRROR_INTERVAL_MS;
  }
  return Math.min(MAX_MIRROR_INTERVAL_MS, Math.max(MIN_MIRROR_INTERVAL_MS, Math.round(parsed)));
}

import type { PrismaClient } from "@prisma/client";

export type AnchorRegistryEntry = {
  anchorId: string;
  projectId: string | null;
  anchorPath: string;
  socketPath: string | null;
  runtimePaused: boolean;
};

export class MultiAnchorBrokerService {
  private readonly registry = new Map<string, AnchorRegistryEntry>();

  constructor(private readonly client: PrismaClient) {}

  async hydrate(): Promise<void> {
    const rows = await this.client.anchorAllocation.findMany({
      where: {
        state: {
          not: "destroyed"
        }
      }
    });
    this.registry.clear();
    for (const row of rows) {
      this.registerAnchor({
        anchorId: row.anchorId,
        projectId: row.projectId,
        anchorPath: row.anchorPath,
        socketPath: row.socketPath,
        runtimePaused: row.runtimePaused
      });
    }
  }

  registerAnchor(entry: AnchorRegistryEntry): void {
    this.registry.set(entry.anchorId, entry);
  }

  unregisterAnchor(anchorId: string): void {
    this.registry.delete(anchorId);
  }

  async resolveAnchor(anchorId: string): Promise<AnchorRegistryEntry | null> {
    const cached = this.registry.get(anchorId);
    if (cached) {
      return cached;
    }

    const row = await this.client.anchorAllocation.findUnique({
      where: {
        anchorId
      }
    });
    if (!row || row.state === "destroyed") {
      return null;
    }

    const entry = {
      anchorId: row.anchorId,
      projectId: row.projectId,
      anchorPath: row.anchorPath,
      socketPath: row.socketPath,
      runtimePaused: row.runtimePaused
    };
    this.registerAnchor(entry);
    return entry;
  }

  async listAnchors(): Promise<AnchorRegistryEntry[]> {
    await this.hydrate();
    return [...this.registry.values()];
  }
}

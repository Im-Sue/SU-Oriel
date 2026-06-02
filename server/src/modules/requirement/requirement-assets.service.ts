import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIREMENT_ASSET_MAX_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, "png" | "jpg" | "webp" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

export class RequirementAssetError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface StoredRequirementAsset {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface CleanupTmpRequirementAssetsOptions {
  olderThanMs: number;
  now?: Date;
  apply?: boolean;
}

export interface CleanupTmpRequirementAssetsResult {
  scannedOwners: string[];
  removedOwners: string[];
  apply: boolean;
}

export function toTmpRequirementAssetOwner(tmpUuid: string): string {
  return tmpUuid.startsWith("tmp-") ? tmpUuid : `tmp-${tmpUuid}`;
}

export function validateRequirementAssetOwner(owner: string): string {
  const normalized = owner.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new RequirementAssetError("图片目录参数不合法");
  }
  return normalized;
}

export function rewriteRequirementAssetReferences(value: string | undefined, tmpUuid: string, requirementId: string) {
  if (value === undefined) return undefined;
  const owner = toTmpRequirementAssetOwner(tmpUuid);
  return value.split(`./assets/requirements/${owner}/`).join(`./assets/requirements/${requirementId}/`);
}

export async function storeRequirementAsset(
  projectRoot: string,
  owner: string,
  file: Buffer,
  mimeType: string
): Promise<StoredRequirementAsset> {
  const safeOwner = validateRequirementAssetOwner(owner);
  const ext = MIME_EXTENSIONS[mimeType];
  if (!ext) {
    throw new RequirementAssetError("仅支持 png / jpeg / webp / gif 图片格式");
  }
  if (file.length > REQUIREMENT_ASSET_MAX_BYTES) {
    throw new RequirementAssetError("图片不能超过 5MB");
  }

  const hash = createHash("sha256").update(file).digest("hex");
  const filename = `${hash}.${ext}`;
  const dir = join(projectRoot, "docs", ".ccb", "assets", "requirements", safeOwner);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, filename), file, { flag: "wx" });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }

  return {
    path: `./assets/requirements/${safeOwner}/${filename}`,
    filename,
    mimeType,
    size: file.length
  };
}

export async function finalizeRequirementAssets(
  projectRoot: string,
  tmpUuid: string,
  requirementId: string
): Promise<{ finalized: boolean; from: string; to: string }> {
  const tmpOwner = validateRequirementAssetOwner(toTmpRequirementAssetOwner(tmpUuid));
  const finalOwner = validateRequirementAssetOwner(requirementId);
  const root = join(projectRoot, "docs", ".ccb", "assets", "requirements");
  const from = join(root, tmpOwner);
  const to = join(root, finalOwner);

  if (!existsSync(from)) {
    return { finalized: false, from, to };
  }
  if (!existsSync(to)) {
    await rename(from, to);
    return { finalized: true, from, to };
  }

  await mkdir(to, { recursive: true });
  const entries = await readdir(from);
  for (const entry of entries) {
    await rename(join(from, entry), join(to, entry));
  }
  await rm(from, { recursive: true, force: true });
  return { finalized: true, from, to };
}

export async function cleanupTmpRequirementAssets(
  projectRoot: string,
  options: CleanupTmpRequirementAssetsOptions
): Promise<CleanupTmpRequirementAssetsResult> {
  const root = join(projectRoot, "docs", ".ccb", "assets", "requirements");
  const apply = Boolean(options.apply);
  const now = options.now ?? new Date();
  if (!existsSync(root)) {
    return { scannedOwners: [], removedOwners: [], apply };
  }

  const scannedOwners: string[] = [];
  const removedOwners: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("tmp-")) continue;
    scannedOwners.push(entry.name);
    const dir = join(root, entry.name);
    const info = await stat(dir);
    const ageMs = now.getTime() - info.mtime.getTime();
    if (ageMs < options.olderThanMs) continue;
    removedOwners.push(entry.name);
    if (apply) {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    scannedOwners: scannedOwners.sort(),
    removedOwners: removedOwners.sort(),
    apply
  };
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

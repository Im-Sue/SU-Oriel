export interface AnchorSessionCommandResult {
  stdout: string;
  stderr: string;
}

export type AnchorSessionExecFileProcess = (
  command: string,
  args: string[]
) => Promise<AnchorSessionCommandResult>;

export class AnchorSessionResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorSessionResolverError";
  }
}

export async function resolveAnchorTmuxSession(input: {
  tmuxCommand: string;
  socketPath: string;
  anchorPath: string;
  execFileProcess: AnchorSessionExecFileProcess;
}): Promise<string> {
  const { stdout } = await input.execFileProcess(input.tmuxCommand, [
    "-S",
    input.socketPath,
    "list-sessions",
    "-F",
    "#{session_name}"
  ]);
  return selectAnchorSession({
    anchorPath: input.anchorPath,
    sessions: stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  });
}

export function selectAnchorSession(input: { anchorPath: string; sessions: string[] }): string {
  if (input.sessions.length === 0) {
    throw new AnchorSessionResolverError("anchor tmux session not found");
  }
  if (input.sessions.length === 1) {
    const [onlySession] = input.sessions;
    if (!onlySession) {
      throw new AnchorSessionResolverError("anchor tmux session not found");
    }
    return onlySession;
  }

  const signal = normalizeForMatch(lastPathSegment(input.anchorPath));
  const candidates = signal
    ? input.sessions.filter((session) => sessionMatchesAnchorPath(session, signal))
    : [];
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new AnchorSessionResolverError(`anchor tmux session ambiguous: ${candidates.join(", ")}`);
  }
  throw new AnchorSessionResolverError(`anchor tmux session ambiguous: ${input.sessions.join(", ")}`);
}

function sessionMatchesAnchorPath(sessionName: string, normalizedAnchorPathSegment: string): boolean {
  const normalizedSession = normalizeForMatch(sessionName);
  if (normalizedSession.includes(normalizedAnchorPathSegment)) {
    return true;
  }
  return tokensInOrder(normalizedAnchorPathSegment.split("-").filter(Boolean), normalizedSession.split("-").filter(Boolean));
}

function tokensInOrder(needles: string[], haystack: string[]): boolean {
  let offset = 0;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, offset);
    if (next === -1) {
      return false;
    }
    offset = next + 1;
  }
  return needles.length > 0;
}

function lastPathSegment(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? "";
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

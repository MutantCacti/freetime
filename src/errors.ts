// Error codes, references and the debug line shown on the fatal error panel.

export type ErrorCode = "FEED_FETCH" | `FEED_STATUS_${number}` | "FEED_PARSE" | "RANGE_EXPAND" | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly upstreamStatus: number | undefined;

  constructor(code: ErrorCode, message: string, options: { cause?: unknown; upstreamStatus?: number } = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.upstreamStatus = options.upstreamStatus;
  }

  /** 503 for feed problems, 500 for anything else. */
  get status(): 500 | 503 {
    return this.code.startsWith("FEED_") ? 503 : 500;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("INTERNAL", err instanceof Error ? err.message : String(err), { cause: err });
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A short random reference, for example "7K2Q9M". */
export function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

/** "2026-11-02 14:03Z" */
export function utcMinute(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/** "FEED_FETCH · ref 7K2Q9M · 2026-11-02 14:03Z" */
export function debugLine(code: ErrorCode, ref: string, epochSec: number): string {
  return `${code} · ref ${ref} · ${utcMinute(epochSec)}`; // PRINTED OUTPUT: error panel / debug line
}

export type LogFn = (entry: Record<string, unknown>) => void;

export const consoleLog: LogFn = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else console.warn(line);
};

/** Write the full details of an error to the Worker log, with secrets removed. */
export function logError(log: LogFn, err: AppError, ref: string, secrets: (string | undefined)[]): void {
  const scrub = (s: string | undefined) => {
    let out = s ?? "";
    for (const secret of secrets) if (secret) out = out.split(secret).join("[ICAL_URL]");
    return out;
  };
  const cause = err.cause instanceof Error ? err.cause : undefined;
  log({
    level: "error",
    ref,
    code: err.code,
    message: scrub(err.message),
    upstreamStatus: err.upstreamStatus,
    stack: scrub(err.stack),
    cause: cause ? scrub(`${cause.name}: ${cause.message}\n${cause.stack ?? ""}`) : undefined,
  });
}

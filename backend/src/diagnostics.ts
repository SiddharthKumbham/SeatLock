type CodedError = Error & { code?: unknown };

function redact(value: string): string {
  let safe = value;
  for (const key of ["DATABASE_URL", "POSTGRES_PASSWORD", "DATABASE_CA_CERT", "SESSION_SECRET", "RAILWAY_TOKEN", "GITHUB_TOKEN"]) {
    const secret = process.env[key];
    if (secret && secret.length >= 4) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'`]+/gi, "[redacted-url]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[redacted]");
}

export function safeErrorDetails(error: unknown) {
  const failure = error as Partial<CodedError> | null;
  const message = error instanceof Error ? error.message : String(error);
  const frames = error instanceof Error
    ? error.stack?.split("\n").slice(1).filter((line) => /^\s*at\s/.test(line)).slice(0, 5)
    : undefined;
  return {
    type: error instanceof Error ? error.constructor.name : typeof error,
    message: redact(message).slice(0, 500),
    code: typeof failure?.code === "string" ? failure.code : "none",
    stack: frames?.map((frame) => redact(frame.trim()).slice(0, 300)) ?? [],
  };
}

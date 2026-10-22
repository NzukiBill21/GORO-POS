const SENSITIVE_KEY = /password|token|secret|authorization|pin|mpesa|consumer/i;

export function redactValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string' && value.length > 8 && SENSITIVE_KEY.test(value)) return '[REDACTED]';
  return value;
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactObject(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

export function safeErrorLog(message: string, err: unknown): void {
  if (err instanceof Error) {
    console.error(message, err.message);
    if (process.env.NODE_ENV === 'development') console.error(err.stack);
  } else {
    console.error(message, err);
  }
}

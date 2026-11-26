const SENSITIVE_KEY = /(api[-_]?key|secret|token|password|passwd|authorization|credential|cookie|bearer|private[-_]?key)/i;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_\-]{8,}/g, // OpenAI / Anthropic / OpenRouter style
  /\bgsk_[A-Za-z0-9]{8,}/g, // Groq
  /\bxai-[A-Za-z0-9]{8,}/g, // xAI
  /\bpplx-[A-Za-z0-9]{8,}/g, // Perplexity
  /\bAIza[0-9A-Za-z_\-]{20,}/g, // Google
  /\bBearer\s+[A-Za-z0-9._~+/=\-]{8,}/gi,
];

export const REDACTED = '[REDACTED]';

export function redactString(input: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, REDACTED), input);
}

/** Deep-clone `value` with secrets removed. Safe for logs, activity feeds, crash reports. */
export function redact<T = unknown>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]' as T;
  seen.add(value as object);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) } as T;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, seen);
  }
  return out as T;
}

/** Human-safe hint that identifies a key without revealing it: `sk-or-…a1b2`. */
export function maskSecret(secret: string): string {
  const s = secret.trim();
  if (s.length < 9) return '•'.repeat(Math.max(s.length, 4));
  if (s.length < 20) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

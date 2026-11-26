import type { ProviderDefinition, ProviderField } from '@cameleon/shared';
import { AppError } from '../errors.js';

const CONTROL = /[\u0000-\u001F\u007F]/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade']);

export const isLoopbackHost = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');

export interface ValidatedValues {
  set: Record<string, string>;
  clear: string[];
  warnings: string[];
}

function validateField(def: ProviderDefinition, field: ProviderField, value: string, warnings: string[]): string {
  const fail = (message: string): never => {
    throw new AppError(400, 'validation_error', 'Invalid input', [{ path: `values.${field.key}`, message }]);
  };
  switch (field.kind) {
    case 'secret': {
      if (field.key === 'customHeaders') {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { return fail('Must be a JSON object, e.g. {"X-Org":"acme"}'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Must be a JSON object');
        const entries = Object.entries(parsed as Record<string, unknown>);
        if (entries.length > 20) return fail('At most 20 headers');
        for (const [k, v] of entries) {
          if (!/^[A-Za-z0-9-]{1,64}$/.test(k)) return fail(`Invalid header name "${k}"`);
          if (FORBIDDEN_HEADERS.has(k.toLowerCase())) return fail(`Header "${k}" cannot be overridden`);
          if (typeof v !== 'string' || CONTROL.test(v) || v.length > 1000) return fail(`Invalid value for header "${k}"`);
        }
        return JSON.stringify(parsed);
      }
      if (CONTROL.test(value)) return fail('Contains control characters');
      if (field.key === 'apiKey') {
        if (value.length < 8) return fail('Too short to be an API key');
        if (!/^[\x21-\x7E]+$/.test(value)) return fail('API keys contain only printable characters without spaces');
        if (def.keyPrefix && !value.startsWith(def.keyPrefix)) {
          warnings.push(`This key does not start with "${def.keyPrefix}" as ${def.name} keys usually do — double-check it.`);
        }
      }
      return value;
    }
    case 'url': {
      let u: URL;
      try { u = new URL(value); } catch { return fail('Not a valid URL'); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only http(s) URLs are allowed');
      if (u.username || u.password) return fail('Do not embed credentials in the URL');
      if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) {
        warnings.push(`"${u.host}" uses plain HTTP: your key would travel unencrypted on the network.`);
      }
      return value.replace(/\/+$/, '');
    }
    case 'select':
      if (!field.options?.includes(value)) return fail(`Must be one of: ${field.options?.join(', ')}`);
      return value;
    default:
      if (CONTROL.test(value)) return fail('Contains control characters');
      if (value.length > 500) return fail('Too long');
      return value;
  }
}

/** Validate submitted field values against a provider definition. `create` requires mandatory fields; `update` treats '' as "clear". */
export function validateValues(def: ProviderDefinition, values: Record<string, string>, mode: 'create' | 'update'): ValidatedValues {
  const warnings: string[] = [];
  const set: Record<string, string> = {};
  const clear: string[] = [];
  const issues: { path: string; message: string }[] = [];
  const failed = new Set<string>();
  const byKey = new Map(def.fields.map((f) => [f.key, f]));

  for (const [key, raw] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) { issues.push({ path: `values.${key}`, message: `Unknown field for ${def.name}` }); continue; }
    const value = raw.trim();
    if (value === '') {
      if (mode === 'update') clear.push(key);
      continue;
    }
    try {
      set[key] = validateField(def, field, value, warnings);
    } catch (e) {
      if (e instanceof AppError && e.issues) { issues.push(...e.issues); failed.add(key); }
      else throw e;
    }
  }
  if (mode === 'create') {
    for (const f of def.fields) if (f.required && !(f.key in set) && !failed.has(f.key)) issues.push({ path: `values.${f.key}`, message: `${f.label} is required` });
  } else {
    for (const key of clear) if (byKey.get(key)?.required) issues.push({ path: `values.${key}`, message: `${byKey.get(key)!.label} is required` });
  }
  if (issues.length) throw new AppError(400, 'validation_error', 'Invalid input', issues);
  return { set, clear, warnings };
}

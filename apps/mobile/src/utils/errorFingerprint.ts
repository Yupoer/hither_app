/**
 * Privacy-safe error fingerprints and bounded diagnostics for performance_events.
 * Retain enough context to localize failures while redacting tokens, UUIDs,
 * coordinates, and unbounded stacks/messages.
 */

const MAX_KIND = 80;
const MAX_FRAMES = 8;
const MAX_HASH_INPUT = 2_000;

export const MAX_ERROR_MESSAGE = 240;
export const MAX_ERROR_DETAILS = 240;
export const MAX_ERROR_HINT = 160;
export const MAX_ERROR_FRAMES = 800;
export const MAX_COMPONENT_STACK = 600;
export const MAX_SOURCE_LOCATION = 160;
export const MAX_FIELD_STRING = 160;

/** Stable short kind from Error.name (or unclassified). */
export function exceptionKind(error: unknown): string {
  if (error instanceof Error && typeof error.name === 'string' && error.name.length > 0) {
    return error.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, MAX_KIND);
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) {
      return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, MAX_KIND);
    }
  }
  return 'unclassified';
}

/**
 * Redact credentials, long tokens, UUIDs, URL queries, and lat/lng-like pairs
 * from a diagnostic string. Keeps filename/line breadcrumbs useful for triage.
 */
export function redactSensitiveText(input: string): string {
  let s = input;
  // JWT (three base64url segments)
  s = s.replace(
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    '[redacted_jwt]',
  );
  // Bearer / Authorization headers
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]');
  s = s.replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]');
  // Long opaque tokens (API keys, access tokens)
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted_token]');
  // UUIDs
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '[redacted_uuid]',
  );
  // URL query strings
  s = s.replace(/([?&])([^=\s#]+)=([^&\s#]*)/g, '$1$2=[redacted]');
  // Approximate coordinates (lat,lng pairs)
  s = s.replace(
    /(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/g,
    '[redacted_coords]',
  );
  return s;
}

/** Bound + redact a free-form diagnostic string. */
export function boundDiagnosticText(
  value: unknown,
  maxLen: number = MAX_FIELD_STRING,
): string | null {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : String(value);
  if (!raw.trim()) return null;
  return redactSensitiveText(raw).slice(0, maxLen);
}

/** Normalize one stack frame for hashing (drop absolute paths / query strings). */
export function normalizeStackFrame(line: string): string {
  let s = line.trim();
  // Strip file:// and absolute Windows/Unix paths to basenames where possible.
  s = s.replace(/file:\/\/\/[^\s:)]+/g, (m) => {
    const base = m.split(/[/\\]/).pop() ?? m;
    return base;
  });
  s = s.replace(/(?:[A-Za-z]:)?(?:\/|\\)[^\s:)]+\.(?:js|tsx?|jsx|bundle)/gi, (m) => {
    const base = m.split(/[/\\]/).pop() ?? m;
    return base;
  });
  s = s.replace(/\?[^:\s)]+/g, '');
  s = s.replace(/:\d+:\d+/g, '');
  return s.slice(0, 200);
}

/**
 * Keep basename + line:col for localization (redact absolute path / query).
 * Used for human-readable errorFrames, not for hashing.
 */
export function localizeStackFrame(line: string): string {
  let s = line.trim();
  s = s.replace(/file:\/\/\/[^\s:)]+/g, (m) => {
    const base = m.split(/[/\\]/).pop() ?? m;
    return base;
  });
  s = s.replace(/(?:[A-Za-z]:)?(?:\/|\\)[^\s:)]+\.(?:js|tsx?|jsx|bundle)/gi, (m) => {
    const base = m.split(/[/\\]/).pop() ?? m;
    return base;
  });
  s = s.replace(/\?[^:\s)]+/g, '');
  return redactSensitiveText(s).slice(0, 200);
}

function stackLines(error: unknown): string[] {
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  if (typeof error === 'object' && error !== null && 'stack' in error) {
    const stack = (error as { stack?: unknown }).stack;
    if (typeof stack === 'string') {
      return stack.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  }
  return [];
}

/** FNV-1a 32-bit hex — sync, no crypto deps, stable across sessions. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash of first N normalized stack frames + exception kind.
 * Empty stack → kind-only hash so clusters still group.
 */
export function stackHash(error: unknown): string {
  const kind = exceptionKind(error);
  const frames = stackLines(error)
    .slice(0, MAX_FRAMES)
    .map(normalizeStackFrame)
    .filter(Boolean);
  const material = `${kind}|${frames.join('|')}`.slice(0, MAX_HASH_INPUT);
  return fnv1aHex(material);
}

function readErrorField(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as Record<string, unknown>)[key];
}

/** Bounded message for triage (never raw JWT/UUID/coords). */
export function boundedErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return boundDiagnosticText(error.message, MAX_ERROR_MESSAGE);
  }
  if (typeof error === 'string') {
    return boundDiagnosticText(error, MAX_ERROR_MESSAGE);
  }
  const message = readErrorField(error, 'message');
  if (typeof message === 'string') {
    return boundDiagnosticText(message, MAX_ERROR_MESSAGE);
  }
  return null;
}

export function boundedErrorDetails(error: unknown): string | null {
  const details = readErrorField(error, 'details');
  return boundDiagnosticText(details, MAX_ERROR_DETAILS);
}

export function boundedErrorHint(error: unknown): string | null {
  const hint = readErrorField(error, 'hint');
  return boundDiagnosticText(hint, MAX_ERROR_HINT);
}

/** First N localized frames joined with newlines (filename + line kept). */
export function boundedErrorFrames(error: unknown): string | null {
  const frames = stackLines(error)
    .slice(0, MAX_FRAMES)
    .map(localizeStackFrame)
    .filter(Boolean);
  if (frames.length === 0) return null;
  return frames.join('\n').slice(0, MAX_ERROR_FRAMES);
}

/** Best-effort source location from first frame with a file:line pattern. */
export function sourceLocationFromError(error: unknown): string | null {
  for (const line of stackLines(error).slice(0, MAX_FRAMES)) {
    const localized = localizeStackFrame(line);
    const match = localized.match(/([\w.-]+\.(?:js|tsx?|jsx|bundle):\d+(?::\d+)?)/i);
    if (match?.[1]) {
      return match[1].slice(0, MAX_SOURCE_LOCATION);
    }
  }
  return null;
}

/**
 * Sanitize React ErrorInfo.componentStack — keep component names, drop paths,
 * tokens, and unbounded length.
 */
export function boundedComponentStack(componentStack: unknown): string | null {
  if (typeof componentStack !== 'string' || !componentStack.trim()) return null;
  const lines = componentStack
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      // "in Foo (at App.tsx:10)" → keep component + basename:line
      let s = line.replace(/(?:[A-Za-z]:)?(?:\/|\\)[^\s:)]+/g, (m) => {
        const base = m.split(/[/\\]/).pop() ?? m;
        return base;
      });
      s = s.replace(/\?[^:\s)]+/g, '');
      return redactSensitiveText(s).slice(0, 120);
    });
  if (lines.length === 0) return null;
  return lines.join('\n').slice(0, MAX_COMPONENT_STACK);
}

export type ErrorDiagnostics = {
  errorMessage: string | null;
  errorDetails: string | null;
  errorHint: string | null;
  errorFrames: string | null;
  sourceLocation: string | null;
  componentStack: string | null;
  exceptionKind: string;
  stackHash: string;
};

/** Bundle of bounded diagnostics attached to performance error events. */
export function buildErrorDiagnostics(
  error: unknown,
  componentStack?: unknown,
): ErrorDiagnostics {
  return {
    errorMessage: boundedErrorMessage(error),
    errorDetails: boundedErrorDetails(error),
    errorHint: boundedErrorHint(error),
    errorFrames: boundedErrorFrames(error),
    sourceLocation: sourceLocationFromError(error),
    componentStack: boundedComponentStack(componentStack),
    exceptionKind: exceptionKind(error),
    stackHash: stackHash(error),
  };
}

/** Classify common upstream failure families for searchable operations. */
export function classifyUpstreamError(error: unknown): {
  subsystem: string;
  errorCode: string;
  httpStatus: number | null;
} {
  if (typeof error === 'object' && error !== null) {
    const code = readErrorField(error, 'code');
    const status = readErrorField(error, 'status');
    const message = String(readErrorField(error, 'message') ?? '').toLowerCase();
    const name = String(readErrorField(error, 'name') ?? '');

    if (name === 'MapsProxyError') {
      const httpStatus = typeof status === 'number' ? status : null;
      const mapsCode = typeof code === 'string' ? code : 'maps_error';
      return {
        subsystem: 'maps',
        errorCode: mapsCode.slice(0, 80),
        httpStatus,
      };
    }

    if (
      message.includes('leader role required')
      || (typeof code === 'string' && code === 'P0001' && message.includes('leader'))
    ) {
      return {
        subsystem: 'authorization',
        errorCode: 'leader_role_required',
        httpStatus: 403,
      };
    }

    if (
      typeof code === 'string'
      && (code === '23505' || code.toLowerCase().includes('conflict'))
    ) {
      return {
        subsystem: 'registration',
        errorCode: code === '23505' ? 'duplicate_key' : code.slice(0, 80),
        httpStatus: 409,
      };
    }

    if (typeof code === 'string' && code.length > 0) {
      return {
        subsystem: 'api',
        errorCode: code.slice(0, 80),
        httpStatus: typeof status === 'number' ? status : null,
      };
    }
  }

  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (
    msg.includes('network request failed')
    || msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('fetch failed')
  ) {
    return { subsystem: 'network', errorCode: 'network', httpStatus: 0 };
  }

  return { subsystem: 'unknown', errorCode: 'unclassified_error', httpStatus: null };
}

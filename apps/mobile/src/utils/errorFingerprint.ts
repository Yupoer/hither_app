/**
 * Privacy-safe error fingerprints for performance_events.
 * Never include raw messages or full stacks in telemetry payloads.
 */

const MAX_KIND = 80;
const MAX_FRAMES = 8;
const MAX_HASH_INPUT = 2_000;

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

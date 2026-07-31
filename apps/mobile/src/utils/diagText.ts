/** Small redaction helpers shared by ads + diagnostics (no Expo imports). */

export function truncateDiagText(value: unknown, max = 120): string {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

export function tailId(value: string | null | undefined, n = 8): string {
  if (!value) return '';
  return value.length <= n ? value : value.slice(-n);
}

/**
 * Distinguish React render errors, watchdog terminations, and native signals
 * for diagnostics — evidence-first, no new crash SDK.
 */

export type CrashClass =
  | 'react_render'
  | 'watchdog'
  | 'sig11'
  | 'sig10'
  | 'memory_pressure'
  | 'previous_launch_incomplete'
  | 'unknown_native'
  | 'unclassified';

export type CrashClassInput = {
  event?: string | null;
  exceptionKind?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  /** MetricKit / diagnostic payload snippet (already JSON-string or object fields). */
  metricKind?: string | null;
  terminationReason?: string | null;
  signal?: string | number | null;
  exceptionType?: string | null;
};

/**
 * Classify a crash-like event for searchable operations.
 * Prefer explicit MetricKit / system fields over free-form message scraping.
 */
export function classifyCrashClass(input: CrashClassInput): CrashClass {
  const event = (input.event ?? '').toLowerCase();
  const kind = (input.exceptionKind ?? '').toLowerCase();
  const message = (input.errorMessage ?? '').toLowerCase();
  const code = (input.errorCode ?? '').toLowerCase();
  const metricKind = (input.metricKind ?? '').toLowerCase();
  const term = (input.terminationReason ?? '').toLowerCase();
  const exceptionType = (input.exceptionType ?? '').toLowerCase();
  const signalRaw = input.signal;
  const signal =
    typeof signalRaw === 'number'
      ? signalRaw
      : typeof signalRaw === 'string'
        ? Number.parseInt(signalRaw.replace(/[^0-9]/g, ''), 10)
        : NaN;

  if (
    event.includes('react_render')
    || kind.includes('render')
    || message.includes('component stack')
    || code === 'react_render'
  ) {
    return 'react_render';
  }

  if (
    event === 'previous_launch_incomplete'
    || code === 'previous_launch_incomplete'
  ) {
    return 'previous_launch_incomplete';
  }

  if (
    term.includes('watchdog')
    || term.includes('0x8badf00d')
    || message.includes('watchdog')
    || code.includes('watchdog')
    || metricKind.includes('watchdog')
    || exceptionType.includes('watchdog')
  ) {
    return 'watchdog';
  }

  if (
    signal === 11
    || term.includes('sigsegv')
    || term.includes('sig11')
    || message.includes('sigsegv')
    || message.includes('exc_bad_access')
    || code.includes('sig11')
    || exceptionType.includes('exc_bad_access')
  ) {
    return 'sig11';
  }

  if (
    signal === 10
    || term.includes('sigbus')
    || term.includes('sig10')
    || message.includes('sigbus')
    || code.includes('sig10')
  ) {
    return 'sig10';
  }

  if (
    term.includes('memory')
    || message.includes('memory pressure')
    || metricKind.includes('memory')
    || code.includes('memory_pressure')
  ) {
    return 'memory_pressure';
  }

  if (
    metricKind.includes('crash')
    || metricKind.includes('diagnostic')
    || event.includes('metric')
    || event.includes('crash')
  ) {
    return 'unknown_native';
  }

  return 'unclassified';
}

export function classifyMetricPayload(
  kind: string | null | undefined,
  json: string | null | undefined,
): CrashClass {
  const metricKind = (kind ?? '').toLowerCase();
  if (typeof json !== 'string' || json.length === 0) return classifyCrashClass({ metricKind });
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return classifyCrashClass({ metricKind });
  }
  if (!parsed || typeof parsed !== 'object'
      || !('crashDiagnostics' in parsed) || !Array.isArray(parsed.crashDiagnostics)) {
    return classifyCrashClass({ metricKind });
  }
  for (const crash of parsed.crashDiagnostics) {
    if (!crash || typeof crash !== 'object' || !('diagnosticMetaData' in crash)) continue;
    const metadata: unknown = crash.diagnosticMetaData;
    if (!metadata || typeof metadata !== 'object') continue;
    const signal = 'signal' in metadata ? metadata.signal : undefined;
    const terminationReason = 'terminationReason' in metadata ? metadata.terminationReason : undefined;
    const exceptionType = 'exceptionType' in metadata ? metadata.exceptionType : undefined;
    const result = classifyCrashClass({
      metricKind: 'crash',
      signal: typeof signal === 'number' || typeof signal === 'string' ? signal : undefined,
      terminationReason: typeof terminationReason === 'string' ? terminationReason : undefined,
      exceptionType: typeof exceptionType === 'string' ? exceptionType : undefined,
    });
    if (result !== 'unknown_native') return result;
  }
  return classifyCrashClass({ metricKind });
}

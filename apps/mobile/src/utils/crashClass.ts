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

/**
 * Best-effort classification from a MetricKit spool payload JSON string.
 * Scans only allow-listed keys / short substrings — never stores the raw JSON.
 */
export function classifyMetricPayload(
  kind: string | null | undefined,
  json: string | null | undefined,
): CrashClass {
  const metricKind = (kind ?? '').toLowerCase();
  let terminationReason: string | null = null;
  let exceptionType: string | null = null;
  let signal: string | number | null = null;
  let errorMessage: string | null = null;

  if (typeof json === 'string' && json.length > 0) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const readStr = (keys: string[]): string | null => {
          for (const k of keys) {
            const v = obj[k];
            if (typeof v === 'string' && v.length > 0) return v.slice(0, 160);
          }
          return null;
        };
        terminationReason = readStr([
          'terminationReason',
          'termination_reason',
          'exceptionReason',
        ]);
        exceptionType = readStr([
          'exceptionType',
          'exception_type',
          'signalName',
        ]);
        const sig = obj.signal ?? obj.signalNumber ?? obj.exceptionCode;
        if (typeof sig === 'number' || typeof sig === 'string') signal = sig;
        // Bounded substring scan when structure is nested MXDiagnosticPayload-style.
        if (!terminationReason && !exceptionType) {
          const snippet = json.slice(0, 2_000).toLowerCase();
          if (snippet.includes('watchdog') || snippet.includes('0x8badf00d')) {
            errorMessage = 'watchdog';
          } else if (snippet.includes('sigsegv') || snippet.includes('exc_bad_access')) {
            errorMessage = 'exc_bad_access';
          } else if (snippet.includes('sigbus')) {
            errorMessage = 'sigbus';
          }
        }
      }
    } catch {
      // Malformed spool — fall through to kind-only classification.
    }
  }

  return classifyCrashClass({
    event: metricKind.includes('diagnostic') ? 'metric_diagnostic' : 'metric',
    metricKind,
    terminationReason,
    exceptionType,
    signal,
    errorMessage,
  });
}

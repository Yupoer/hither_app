import type { Language } from '../state/PreferencesContext';
import {
  getActiveLanguage,
  translate,
  type TranslationKey,
} from '../i18n';
import { redactSensitiveText } from './errorFingerprint';

/** Stable error families shared by API adapters, queues, and UI call sites. */
export const OPERATION_ERROR_KINDS = [
  'offline_transport',
  'timeout_ambiguous_outcome',
  'session_missing_or_expired',
  'leader_role_rejected',
  'acl_service_access',
  'rate_limited',
  'service_unavailable',
  'server_busy',
  'version_conflict',
  'state_conflict',
  'validation',
  'quota',
  'storage',
  'unknown',
] as const;

export type OperationErrorKind = (typeof OPERATION_ERROR_KINDS)[number];

export interface OperationErrorContext {
  /** Operation name is diagnostic context only; it never changes auth policy. */
  operation?: string;
  /** Used by callers that need to distinguish a timeout with write ambiguity. */
  mutation?: boolean;
}

export interface OperationErrorClassification {
  kind: OperationErrorKind;
  /** Alias for consumers that call this field a category. */
  category: OperationErrorKind;
  /** HTTP status, if supplied by the adapter or nested response. */
  status: number | null;
  /** Supabase/PostgREST/application code, preserved verbatim when present. */
  code: string | null;
  /** Compatibility alias used by existing diagnostic payloads. */
  errorCode: string | null;
  /** Safe, bounded text for diagnostics. The original remains in `cause`. */
  message: string;
  /** Original Error or object-shaped failure. Never stringify this for logs. */
  cause: unknown;
  /** Whether a caller may offer a retry without reconciliation first. */
  retryable: boolean;
  /** A timeout may have reached the server even when the client saw no response. */
  ambiguousOutcome: boolean;
  /** True when the request must not be sent until a user session exists. */
  requiresSession: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

/**
 * Search the small set of shapes emitted by fetch, Supabase, PostgREST and
 * native adapters. The depth is deliberately bounded so a bad object cannot
 * create an expensive recursive walk.
 */
function candidates(error: unknown): UnknownRecord[] {
  const result: UnknownRecord[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    const record = asRecord(value);
    if (!record || seen.has(record) || depth > 2) return;
    seen.add(record);
    result.push(record);
    visit(record.error, depth + 1);
    visit(record.cause, depth + 1);
    visit(record.response, depth + 1);
    const response = asRecord(record.response);
    visit(response?.data, depth + 1);
  };
  visit(error, 0);
  return result;
}

function firstString(records: UnknownRecord[], keys: readonly string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

function readStatus(records: UnknownRecord[]): number | null {
  for (const record of records) {
    for (const key of ['status', 'statusCode', 'httpStatus']) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
    }
  }
  return null;
}

function readCode(records: UnknownRecord[]): string | null {
  return firstString(records, ['code', 'errorCode', 'statusText']);
}

function readMessage(error: unknown, records: UnknownRecord[]): string {
  if (error instanceof Error && error.message) return error.message;
  const message = firstString(records, ['message', 'details', 'hint', 'name']);
  if (message) return message;
  if (typeof error === 'string') return error;
  return '';
}

function classificationText(records: UnknownRecord[], message: string, code: string | null): string {
  const fields = records.flatMap((record) =>
    ['message', 'details', 'hint', 'name', 'code', 'errorCode'].flatMap((key) => {
      const value = record[key];
      return typeof value === 'string' ? [value] : [];
    }),
  );
  return [message, code ?? '', ...fields].join(' ').toLowerCase();
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isAlreadyClassified(value: unknown): value is OperationErrorClassification {
  return isRecord(value)
    && typeof value.kind === 'string'
    && (OPERATION_ERROR_KINDS as readonly string[]).includes(value.kind)
    && 'cause' in value
    && 'status' in value
    && 'code' in value;
}

function kindPolicy(kind: OperationErrorKind): Pick<
  OperationErrorClassification,
  'retryable' | 'ambiguousOutcome' | 'requiresSession'
> {
  switch (kind) {
    case 'offline_transport':
    case 'rate_limited':
    case 'service_unavailable':
    case 'server_busy':
      return { retryable: true, ambiguousOutcome: false, requiresSession: false };
    case 'timeout_ambiguous_outcome':
      return { retryable: false, ambiguousOutcome: true, requiresSession: false };
    case 'session_missing_or_expired':
      return { retryable: true, ambiguousOutcome: false, requiresSession: true };
    default:
      return { retryable: false, ambiguousOutcome: false, requiresSession: false };
  }
}

/**
 * Classify an API failure without relying on `instanceof Error`.
 *
 * In particular, SQLSTATE 42501 is intentionally split by message: an
 * explicit leader-role rejection is different from a generic ACL/service
 * permission failure, and neither should be inferred from the code alone.
 */
export function classifyOperationError(
  error: unknown,
  _context: OperationErrorContext = {},
): OperationErrorClassification {
  if (isAlreadyClassified(error)) return error;

  const records = candidates(error);
  const status = readStatus(records);
  const code = readCode(records);
  const message = readMessage(error, records);
  const text = classificationText(records, message, code);
  const normalizedCode = code?.toLowerCase() ?? '';
  let kind: OperationErrorKind = 'unknown';

  if (hasAny(text, [
    /err_key_chain/i,
    /keychain/i,
    /securestore/i,
    /storage unavailable/i,
    /sqlite/i,
    /database is locked/i,
    /disk full/i,
  ])) {
    kind = 'storage';
  } else if (hasAny(text, [
    /timed?\s*out/i,
    /timeout/i,
    /etimedout/i,
    /econnaborted/i,
    /aborterror/i,
    /statement timeout/i,
  ]) || status === 408 || status === 504 || normalizedCode === '408' || normalizedCode === '504') {
    kind = 'timeout_ambiguous_outcome';
  } else if (status === 0 || hasAny(text, [
    /network request failed/i,
    /failed to fetch/i,
    /networkerror/i,
    /fetch failed/i,
    /offline/i,
    /connection (?:was )?lost/i,
    /enetunreach/i,
    /ehostunreach/i,
    /enotfound/i,
    /econnreset/i,
    /err_network/i,
  ])) {
    kind = 'offline_transport';
  } else if (
    status === 401
    || normalizedCode === 'session_missing_or_expired'
    || normalizedCode === 'auth_session_missing'
    || normalizedCode === 'local_auth_actor_missing'
    || normalizedCode === 'account_changed'
    || normalizedCode === '28000'
    || normalizedCode === 'pgrst301'
    || normalizedCode === 'pgrst302'
    || hasAny(text, [
      /not authenticated/i,
      /authentication required/i,
      /auth(?:entication)? session (?:is )?missing/i,
      /authenticated session (?:is )?missing/i,
      /session (?:is )?missing/i,
      /session expired/i,
      /jwt expired/i,
      /invalid jwt/i,
      /anonymous access expired/i,
      /token has expired/i,
    ])
  ) {
    kind = 'session_missing_or_expired';
  } else if (hasAny(text, [
    /leader role required/i,
    /leader membership required/i,
    /scope leader membership required/i,
    /only leaders? may/i,
    /organizer role required/i,
  ])) {
    kind = 'leader_role_rejected';
  } else if (
    normalizedCode === 'p0004'
    || normalizedCode.includes('quota')
    || /(?:quota|member|point|storage|plan)[_-]?limit/.test(normalizedCode)
    || hasAny(text, [/quota/i, /point limit/i, /member limit/i, /usage exceeded/i])
  ) {
    kind = 'quota';
  } else if (status === 429 || normalizedCode === '429' || hasAny(text, [/too many requests/i, /rate_limited/i, /rate limit exceeded/i])) {
    kind = 'rate_limited';
  } else if (
    status === 503
    || status === 502
    || normalizedCode === '503'
    || hasAny(text, [/service unavailable/i, /upstream unavailable/i, /temporarily unavailable/i])
  ) {
    kind = 'service_unavailable';
  } else if (normalizedCode === '40001' || normalizedCode === '40p01'
    || hasAny(text, [/could not serialize access/i, /serialization failure/i, /deadlock detected/i])) {
    kind = 'server_busy';
  } else if (normalizedCode === 'invalid_transition' || normalizedCode === 'dependency_missing') {
    kind = 'state_conflict';
  } else if (
    normalizedCode === 'stale_version'
    || normalizedCode === 'version_conflict'
    || normalizedCode === 'conflict'
    || hasAny(text, [/stale version/i, /version conflict/i, /version mismatch/i, /expected version/i])
    || status === 409
  ) {
    kind = 'version_conflict';
  } else if (
    normalizedCode.startsWith('22')
    || status === 400
    || status === 422
    || hasAny(text, [/validation/i, /invalid input/i, /invalid .* payload/i, /malformed/i])
  ) {
    kind = 'validation';
  } else if (
    status === 403
    || normalizedCode === '42501'
    || hasAny(text, [
      /permission denied/i,
      /row-level security/i,
      /not a group member/i,
      /membership required/i,
      /access denied/i,
      /forbidden/i,
      /not authorized/i,
      /service access/i,
    ])
  ) {
    kind = 'acl_service_access';
  }

  const policy = kindPolicy(kind);
  const safeMessage = redactSensitiveText(message).slice(0, 240);
  return {
    kind,
    category: kind,
    status,
    code,
    errorCode: code,
    message: safeMessage,
    cause: error,
    ...policy,
  };
}

/** True when a value looks like a Supabase `{ data, error }` result failure. */
export function getOperationResultError(value: unknown): unknown | null {
  if (!isRecord(value) || !('error' in value)) return null;
  return value.error == null ? null : value.error;
}

export function isSessionOperationError(error: unknown): boolean {
  return classifyOperationError(error).kind === 'session_missing_or_expired';
}

const OPERATION_ERROR_MESSAGE_KEYS: Record<OperationErrorKind, TranslationKey> = {
  offline_transport: 'operationError.offline',
  timeout_ambiguous_outcome: 'operationError.timeout',
  session_missing_or_expired: 'operationError.session',
  leader_role_rejected: 'operationError.leader',
  acl_service_access: 'operationError.access',
  rate_limited: 'operationError.rateLimited',
  service_unavailable: 'operationError.unavailable',
  server_busy: 'operationError.serverBusy',
  version_conflict: 'operationError.versionConflict',
  state_conflict: 'operationError.stateConflict',
  validation: 'operationError.validation',
  quota: 'operationError.quota',
  storage: 'operationError.storage',
  unknown: 'operationError.unknown',
};

/** Shared localized message mapper. Supported languages are `zh` and `en`. */
export function getOperationErrorMessage(
  error: unknown,
  language: Language = getActiveLanguage(),
): string {
  const classification = classifyOperationError(error);
  return translate(language, OPERATION_ERROR_MESSAGE_KEYS[classification.kind]);
}

export const operationErrorMessage = getOperationErrorMessage;
export const mapOperationErrorToMessage = getOperationErrorMessage;

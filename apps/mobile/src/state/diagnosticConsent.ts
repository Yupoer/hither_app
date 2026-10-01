import AsyncStorage from '@react-native-async-storage/async-storage';

export const DIAGNOSTIC_CONSENT_KEY = 'pref.diagnosticUploadEnabled';

let hydrated = false;
let enabled = false;
let choiceRevision = 0;
let hydration: Promise<boolean> | null = null;
const pendingSubmissions = new Set<() => void>();

export function isDiagnosticConsentEnabled(): boolean {
  return hydrated && enabled;
}

/** Invalidates in-flight batches across revoke/re-enable, not just while OFF. */
export function getDiagnosticConsentRevision(): number { return choiceRevision; }
export function isDiagnosticConsentCurrent(revision: number): boolean {
  return isDiagnosticConsentEnabled() && choiceRevision === revision;
}

/** Also fences token lookup/auth recovery inside the lazy Supabase request. */
export function createDiagnosticSubmissionAbort(revision: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  pendingSubmissions.add(cancel);
  if (!isDiagnosticConsentCurrent(revision)) cancel();
  return { signal: controller.signal, dispose: () => { pendingSubmissions.delete(cancel); } };
}

export function hydrateDiagnosticConsent(value: string | null): boolean {
  enabled = value === 'true';
  hydrated = true;
  return enabled;
}

export function getDiagnosticConsentEnabled(): Promise<boolean> {
  if (hydrated) return Promise.resolve(enabled);
  if (!hydration) {
    hydration = AsyncStorage.getItem(DIAGNOSTIC_CONSENT_KEY)
      // A user choice made during the read takes precedence over stored state.
      .then((value) => hydrated ? enabled : hydrateDiagnosticConsent(value))
      .finally(() => {
        hydration = null;
      });
  }
  return hydration;
}

export async function setDiagnosticConsentEnabled(next: boolean): Promise<void> {
  const revision = ++choiceRevision;
  for (const cancel of pendingSubmissions) cancel();
  if (!next) enabled = false;
  hydrated = true;
  try {
    await AsyncStorage.setItem(DIAGNOSTIC_CONSENT_KEY, next ? 'true' : 'false');
    if (choiceRevision === revision) enabled = next;
  } catch (error) {
    // Failed enable stays off. A failed revoke must also remain off this session.
    if (choiceRevision === revision) enabled = false;
    throw error;
  }
}

/** Test helper — resets module state between Jest cases. */
export function __resetDiagnosticConsentForTests(): void {
  hydrated = false;
  enabled = false;
  hydration = null;
}

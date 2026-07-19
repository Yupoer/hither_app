import AsyncStorage from '@react-native-async-storage/async-storage';

export const DIAGNOSTIC_CONSENT_KEY = 'pref.diagnosticUploadEnabled';

let hydrated = false;
let enabled = false;
let hydration: Promise<boolean> | null = null;

export function isDiagnosticConsentEnabled(): boolean {
  return hydrated && enabled;
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
      .then(hydrateDiagnosticConsent)
      .finally(() => {
        hydration = null;
      });
  }
  return hydration;
}

export async function setDiagnosticConsentEnabled(next: boolean): Promise<void> {
  enabled = next;
  hydrated = true;
  await AsyncStorage.setItem(DIAGNOSTIC_CONSENT_KEY, next ? 'true' : 'false');
}

/** Test helper — resets module state between Jest cases. */
export function __resetDiagnosticConsentForTests(): void {
  hydrated = false;
  enabled = false;
  hydration = null;
}

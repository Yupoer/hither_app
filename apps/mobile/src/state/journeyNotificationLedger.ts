import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@hither/journey-notification-ledger-v1';
let serial: Promise<unknown> = Promise.resolve();

/** Serialize read/modify/write so simultaneous foreground/background events cannot erase keys. */
export function deliverJourneyEventOnce(key: string, deliver: () => Promise<string | null>): Promise<void> {
  const run = serial.then(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let keys: string[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) keys = parsed.filter((value): value is string => typeof value === 'string');
      } catch { /* A corrupt notification cache must not crash navigation. */ }
    }
    if (keys.includes(key)) return;
    // Claim durably before dispatch: a process death cannot replay a stale sound.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...keys.slice(-399), key]));
    try {
      if (await deliver()) return;
    } catch (error) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-400)));
      throw error;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-400)));
  });
  serial = run.catch(() => undefined);
  return run;
}

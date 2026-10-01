const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
}));

describe('diagnostic consent', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.clear();
  });

  it('defaults to off when no preference exists', async () => {
    const consent = await import('../state/diagnosticConsent');
    await expect(consent.getDiagnosticConsentEnabled()).resolves.toBe(false);
    expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  });

  it('grants capture only after persistence succeeds', async () => {
    const consent = await import('../state/diagnosticConsent');
    const pending = consent.setDiagnosticConsentEnabled(true);
    expect(consent.isDiagnosticConsentEnabled()).toBe(false);
    await pending;
    expect(consent.isDiagnosticConsentEnabled()).toBe(true);
    expect(mockStorage.get(consent.DIAGNOSTIC_CONSENT_KEY)).toBe('true');
  });

  it('does not treat __DEV__ as consent', async () => {
    const consent = await import('../state/diagnosticConsent');
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../state/diagnosticConsent.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/__DEV__/);
    expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  });

  it('does not restore stale consent when it is revoked during hydration', async () => {
    const consent = await import('../state/diagnosticConsent');
    mockStorage.set(consent.DIAGNOSTIC_CONSENT_KEY, 'true');
    const hydration = consent.getDiagnosticConsentEnabled();
    await consent.setDiagnosticConsentEnabled(false);
    await expect(hydration).resolves.toBe(false);
    expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  });
});


it('never grants consent during a failed enable and revokes immediately on storage failure', async () => {
  const consent = await import('../state/diagnosticConsent');
  consent.__resetDiagnosticConsentForTests();
  const storage = require('@react-native-async-storage/async-storage');
  let reject: (error: Error) => void = () => undefined;
  storage.setItem.mockImplementationOnce(() => new Promise((_, failed) => { reject = failed; }));
  const pending = consent.setDiagnosticConsentEnabled(true);
  expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  reject(new Error('disk full'));
  await expect(pending).rejects.toThrow('disk full');
  expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  consent.hydrateDiagnosticConsent('true');
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  const off = consent.setDiagnosticConsentEnabled(false);
  expect(consent.isDiagnosticConsentEnabled()).toBe(false);
  await expect(off).rejects.toThrow('disk full');
});

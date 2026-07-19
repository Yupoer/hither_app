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

  it('changes the synchronous gate before persisting', async () => {
    const consent = await import('../state/diagnosticConsent');
    const pending = consent.setDiagnosticConsentEnabled(true);
    expect(consent.isDiagnosticConsentEnabled()).toBe(true);
    await pending;
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
});

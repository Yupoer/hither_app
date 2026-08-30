export type LegalDocument = 'privacy' | 'terms';

export function getLegalUrl(document: LegalDocument): string | undefined {
  const value = document === 'privacy'
    ? process.env.EXPO_PUBLIC_PRIVACY_URL
    : process.env.EXPO_PUBLIC_TERMS_URL;
  return value && /^https:\/\//.test(value) ? value : undefined;
}

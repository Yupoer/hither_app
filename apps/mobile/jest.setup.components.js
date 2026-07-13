// Expo CLI loads apps/mobile/.env for builds, but Jest does not. Component
// tests only need a syntactically valid client configuration; all network
// boundaries remain mocked by the individual suites.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key';

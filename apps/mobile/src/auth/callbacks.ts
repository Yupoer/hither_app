import * as Crypto from 'expo-crypto';
import { supabaseAuthStorage } from '../api/authStorage';
import { supabase } from '../api/supabase';
import { changeAuthSession, resumeInstallationCapabilities } from '../api/installationCapabilities';

type CallbackKind = 'oauth' | 'link' | 'signup' | 'recovery';
type Transaction = { state: string; kind: CallbackKind; expiresAt: number };
const KEY = 'hither.auth-pending-transaction';
let exchanging: { url: string; result: ReturnType<typeof exchange> } | null = null;

export function authCallbackOrigin(): string {
  const value = process.env.EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN ?? 'https://hither-legal.pages.dev';
  if (!value) throw new Error('HTTPS auth callback origin is not configured.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Auth callback origin must be an HTTPS origin without a path.');
  }
  return url.origin;
}

export async function beginAuthCallback(kind: CallbackKind): Promise<string> {
  const origin = authCallbackOrigin();
  const transaction: Transaction = { state: Crypto.randomUUID(), kind, expiresAt: Date.now() + 86_400_000 };
  await supabaseAuthStorage.setItem(KEY, JSON.stringify(transaction));
  exchanging = null;
  return `${origin}/auth/${kind === 'recovery' ? 'recovery' : 'callback'}?state=${transaction.state}`;
}

export async function cancelAuthCallback(): Promise<void> {
  await supabaseAuthStorage.removeItem(KEY);
  exchanging = null;
}

export function validateAuthCallback(url: string, pending: Transaction, origin: string): string | null {
  try {
    const parsed = new URL(url);
    const path = pending.kind === 'recovery' ? '/auth/recovery' : '/auth/callback';
    const params = parsed.searchParams;
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== path
      || parsed.hash || pending.expiresAt <= Date.now() || params.getAll('state').length !== 1
      || params.get('state') !== pending.state || params.getAll('code').length !== 1
      || params.has('access_token') || params.has('refresh_token') || params.has('error')) return null;
    return params.get('code') || null;
  } catch { return null; }
}

async function exchange(url: string) {
  const stored = await supabaseAuthStorage.getItem(KEY);
  if (!stored) return null;
  let pending: Transaction;
  try { pending = JSON.parse(stored); } catch { return null; }
  const code = validateAuthCallback(url, pending, authCallbackOrigin());
  if (!code) return null;
  // Consume before any network call; an invalid PKCE exchange cannot be replayed.
  await supabaseAuthStorage.removeItem(KEY);
  const result = await changeAuthSession(() => supabase.auth.exchangeCodeForSession(code), pending.kind !== 'link');
  if (result.error) throw result.error;
  resumeInstallationCapabilities();
  return { ...result.data, recovery: pending.kind === 'recovery' };
}

export function consumeAuthCallback(url: string): ReturnType<typeof exchange> {
  // Linking and the auth browser can deliver the same callback together.
  if (exchanging) return exchanging.url === url ? exchanging.result : Promise.resolve(null);
  const result = exchange(url);
  exchanging = { url, result };
  void result.finally(() => { if (exchanging?.result === result) exchanging = null; }).catch(() => undefined);
  return result;
}

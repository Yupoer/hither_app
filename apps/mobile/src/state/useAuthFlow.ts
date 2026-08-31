import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from '../api/supabase';
import {
  updateNickname as updateNicknameApi,
  updateProfile as updateProfileApi,
} from '../api/client';
import {
  normalizeAccountPreferences,
  type AccountPreferences,
  type User,
} from '../types';
import {
  AuthFlowError,
  type EmailSignUpResult,
  toAuthFlowError,
} from '../auth/types';
import type { Membership } from './SessionContext';
import { displayMemberAvatar } from '../constants/avatars';
import { getGoogleIdToken, usesNativeGoogleSignIn } from './googleSignIn';

const AUTH_CALLBACK_URL = 'hither://auth/callback';

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  app_metadata?: { provider?: string };
  user_metadata?: Record<string, unknown>;
  identities?: unknown[] | null;
};

async function materializeUser(authUser: SupabaseAuthUser, nickname?: string): Promise<User> {
  const meta = authUser.user_metadata ?? {};
  const { data: existing } = await supabase
    .from('profiles')
    .select('nickname, avatar, preferences')
    .eq('id', authUser.id)
    .maybeSingle();
  const existingRow = existing as {
    nickname?: string;
    avatar?: string | null;
    preferences?: unknown;
  } | null;
  const metadataName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.nickname === 'string' && meta.nickname) ||
    '';
  const name =
    nickname?.trim() ||
    existingRow?.nickname ||
    metadataName ||
    authUser.email?.split('@')[0] ||
    '';
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: authUser.id, nickname: name }, { onConflict: 'id' });
  if (profileError) throw toAuthFlowError(profileError, 'Unable to save your profile.');
  return {
    id: authUser.id,
    name,
    email: authUser.email ?? '',
    avatar: displayMemberAvatar(existingRow?.avatar, authUser.id).emoji,
    provider: authUser.app_metadata?.provider,
    preferences: normalizeAccountPreferences(existingRow?.preferences),
  };
}

export interface UseAuthFlowParams {
  user: User | null;
  isAnonymous?: boolean;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setIsAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPro: React.Dispatch<React.SetStateAction<boolean>>;
  setMembershipState: React.Dispatch<React.SetStateAction<Membership | null>>;
}

export function useAuthFlow({
  user,
  isAnonymous = false,
  setUser,
  setIsAnonymous,
  setIsPro,
  setMembershipState,
}: UseAuthFlowParams) {
  const signIn = useCallback(
    async ({ name }: { name: string; email?: string }): Promise<User> => {
      const nickname = name.trim();
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) {
        throw new Error(error?.message ?? '匿名登入失敗');
      }
      const userId = data.user.id;
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: userId, nickname }, { onConflict: 'id' });
      if (profileError) {
        throw new Error(profileError.message);
      }
      const nextUser: User = { id: userId, name: nickname, email: '' };
      setUser(nextUser);
      setIsAnonymous(true);
      return nextUser;
    },
    [setUser, setIsAnonymous],
  );

  const signInWithGoogle = useCallback(
    async (nickname?: string): Promise<User | null> => {
      let authUser: SupabaseAuthUser | null = null;
      try {
        const token = await getGoogleIdToken();
        if (!token) return null;
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token,
        });
        if (error || !data.user) {
          throw toAuthFlowError(error, 'Google Sign-In failed.');
        }
        authUser = data.user;
      } catch (error) {
        // Android retains the hosted fallback because the native Google module
        // is iOS-only in this release. iOS must never fall back to the
        // Supabase project host, which is what caused the misleading system
        // prompt and the redirect_uri_mismatch screen.
        if (!usesNativeGoogleSignIn && (error as { code?: string }).code === 'google_native_unavailable') {
          const redirectTo = makeRedirectUri({
            scheme: 'hither',
            path: 'auth/callback',
          });
          const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo,
              skipBrowserRedirect: true,
              queryParams: { prompt: 'select_account' },
            },
          });
          if (oauthError || !data?.url) {
            throw toAuthFlowError(oauthError, 'Google Sign-In failed.');
          }
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
          if (result.type !== 'success') return null;

          const { params, errorCode } = QueryParams.getQueryParams(result.url);
          if (errorCode) throw new AuthFlowError(errorCode, errorCode);
          const { access_token, refresh_token } = params;
          if (!access_token) {
            throw new AuthFlowError(
              'Google Sign-In did not return credentials.',
              'google_token_missing',
            );
          }
          const session = await supabase.auth.setSession({ access_token, refresh_token });
          if (session.error || !session.data.user) {
            throw toAuthFlowError(session.error, 'Google Sign-In failed.');
          }
          authUser = session.data.user;
        } else {
          throw toAuthFlowError(error, 'Google Sign-In failed.');
        }
      }

      if (!authUser) return null;
      const nextUser = await materializeUser(authUser, nickname);
      setUser(nextUser);
      setIsAnonymous(false);
      return nextUser;
    },
    [setUser, setIsAnonymous],
  );

  const signInWithApple = useCallback(async (): Promise<User | null> => {
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        nonce: hashedNonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new AuthFlowError('Apple did not return an identity token.', 'apple_token_missing');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error || !data.user) {
        throw toAuthFlowError(error, 'Apple Sign-In failed.');
      }

      const authUser = data.user;
      const { data: existing } = await supabase
        .from('profiles')
        .select('nickname, avatar, preferences')
        .eq('id', authUser.id)
        .maybeSingle();
      const existingRow = existing as {
        nickname?: string;
        avatar?: string | null;
        preferences?: unknown;
      } | null;
      const appleName = [
        credential.fullName?.givenName,
        credential.fullName?.middleName,
        credential.fullName?.familyName,
      ].filter(Boolean).join(' ');
      const name = appleName
        || existingRow?.nickname
        || authUser.email?.split('@')[0]
        || credential.email?.split('@')[0]
        || 'Apple User';

      if (appleName) {
        const { error: metadataError } = await supabase.auth.updateUser({
          data: {
            full_name: appleName,
            given_name: credential.fullName?.givenName,
            family_name: credential.fullName?.familyName,
          },
        });
        if (metadataError) throw toAuthFlowError(metadataError, 'Unable to save your profile.');
      }
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: authUser.id, nickname: name }, { onConflict: 'id' });
      if (profileError) throw toAuthFlowError(profileError, 'Unable to save your profile.');

      const nextUser: User = {
        id: authUser.id,
        name,
        email: authUser.email ?? credential.email ?? '',
        avatar: displayMemberAvatar(existingRow?.avatar, authUser.id).emoji,
        preferences: normalizeAccountPreferences(existingRow?.preferences),
      };
      setUser(nextUser);
      setIsAnonymous(false);
      return nextUser;
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
      throw error;
    }
  }, [setIsAnonymous, setUser]);

  const linkWithGoogle = useCallback(async (): Promise<User | null> => {
    if (!user) throw new Error('No active account to link');

    let authUser: SupabaseAuthUser | null = null;
    let useHostedFallback = false;
    try {
      const token = await getGoogleIdToken();
      if (!token) return null;
      const linked = await supabase.auth.linkIdentity({ provider: 'google', token });
      if (linked.error || !linked.data.user) {
        throw toAuthFlowError(linked.error, 'Google linking failed.');
      }
      authUser = linked.data.user;
    } catch (error) {
      // Native iOS linking must not reopen the Supabase-hosted prompt. Android
      // can retain its existing browser flow until its native module is built.
      if (!usesNativeGoogleSignIn && (error as { code?: string }).code === 'google_native_unavailable') {
        useHostedFallback = true;
      } else {
        throw toAuthFlowError(error, 'Google linking failed.');
      }
    }

    if (useHostedFallback) {
      const redirectTo = makeRedirectUri({
        scheme: 'hither',
        path: 'auth/callback',
      });
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error || !data?.url) {
        throw toAuthFlowError(error, 'Google linking failed.');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return null;

      const { params, errorCode } = QueryParams.getQueryParams(result.url);
      if (errorCode) throw new AuthFlowError(errorCode, errorCode);
      if (params.code) {
        const exchanged = await supabase.auth.exchangeCodeForSession(params.code);
        if (exchanged.error || !exchanged.data.user) {
          throw toAuthFlowError(exchanged.error, 'Google linking failed.');
        }
        authUser = exchanged.data.user;
      } else if (params.access_token) {
        const session = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (session.error || !session.data.user) {
          throw toAuthFlowError(session.error, 'Google linking failed.');
        }
        authUser = session.data.user;
      } else {
        const current = await supabase.auth.getUser();
        if (current.error || !current.data.user) {
          throw toAuthFlowError(current.error, 'Google linking failed.');
        }
        authUser = current.data.user;
      }
    }

    if (!authUser) return null;

    // Preserve the same UID. Only the SECURITY DEFINER RPC may clear
    // anonymous_expires_at, and only when is_anonymous is already false.
    await supabase.rpc('clear_anonymous_expiry_if_registered', {
      p_uid: user.id,
    }).then(() => undefined, () => undefined);

    const { data: refreshed } = await supabase.auth.getUser();
    const stillAnon = !!refreshed.user?.is_anonymous;
    const nextUser = {
      ...user,
      email: authUser.email ?? user.email,
      provider: stillAnon ? user.provider : 'google',
      anonymousExpiresAt: stillAnon ? user.anonymousExpiresAt : undefined,
    };
    setUser(nextUser);
    setIsAnonymous(stillAnon);
    return nextUser;
  }, [setIsAnonymous, setUser, user]);

  const linkWithApple = useCallback(async (): Promise<User | null> => {
    if (!user) throw new Error('No active account to link');
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        nonce: hashedNonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('Apple linking failed');

      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error || !data.user) {
        throw new Error(error?.message ?? 'Apple linking failed');
      }

      await supabase.rpc('clear_anonymous_expiry_if_registered', {
        p_uid: user.id,
      }).then(() => undefined, () => undefined);

      const { data: refreshed } = await supabase.auth.getUser();
      const stillAnon = !!refreshed.user?.is_anonymous;
      const nextUser = {
        ...user,
        email: data.user.email ?? credential.email ?? user.email,
        provider: stillAnon ? user.provider : 'apple',
        anonymousExpiresAt: stillAnon ? user.anonymousExpiresAt : undefined,
      };
      setUser(nextUser);
      setIsAnonymous(stillAnon);
      return nextUser;
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
      throw error;
    }
  }, [setIsAnonymous, setUser, user]);

  const signInWithEmail = useCallback(
    async ({ email, password }: { email: string; password: string }): Promise<User> => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.user) {
        throw toAuthFlowError(error, 'Email sign-in failed.');
      }
      const userId = data.user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname, avatar, preferences')
        .eq('id', userId)
        .maybeSingle();
      const row = profile as {
        nickname?: string;
        avatar?: string | null;
        preferences?: unknown;
      } | null;
      const nextUser: User = {
        id: userId,
        name:
          row?.nickname ??
          (typeof data.user.user_metadata?.nickname === 'string'
            ? data.user.user_metadata.nickname
            : ''),
        email: data.user.email ?? '',
        avatar: displayMemberAvatar(row?.avatar, userId).emoji,
        preferences: normalizeAccountPreferences(row?.preferences),
      };
      setUser(nextUser);
      setIsAnonymous(false);
      return nextUser;
    },
    [setUser, setIsAnonymous],
  );

  const signUpWithEmail = useCallback(
    async ({ email, password, nickname }: {
      email: string;
      password: string;
      nickname: string;
    }): Promise<EmailSignUpResult> => {
      const trimmed = nickname.trim();
      const normalizedEmail = email.trim();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { nickname: trimmed },
          emailRedirectTo: AUTH_CALLBACK_URL,
        },
      });
      if (error) throw toAuthFlowError(error, 'Email sign-up failed.');
      if (!data.user) {
        throw new AuthFlowError('Email sign-up did not return a user.', 'auth_user_missing');
      }
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new AuthFlowError('This email is already registered.', 'user_already_exists');
      }
      if (!data.session) {
        return { status: 'verification_required', email: normalizedEmail };
      }
      const nextUser = await materializeUser(data.user, trimmed);
      setUser(nextUser);
      setIsAnonymous(false);
      return { status: 'signed_in', user: nextUser };
    },
    [setUser, setIsAnonymous],
  );

  const signOut = useCallback(async () => {
    if (isAnonymous) {
      const { error } = await supabase.rpc('delete_anonymous_account');
      if (error) throw new Error(error.message);
      await supabase.auth.signOut({ scope: 'local' });
    } else {
      await supabase.auth.signOut();
    }
    setUser(null);
    setIsAnonymous(false);
    setIsPro(false);
    setMembershipState(null);
  }, [isAnonymous, setUser, setIsAnonymous, setIsPro, setMembershipState]);

  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc('delete_anonymous_account');
    if (error) throw new Error(error.message);
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setIsAnonymous(false);
    setIsPro(false);
    setMembershipState(null);
  }, [setUser, setIsAnonymous, setIsPro, setMembershipState]);

  const upgradeToEmailAccount = useCallback(
    async (email: string, password: string) => {
      if (!user) throw new Error('No active account to upgrade');
      const uid = user.id;
      // updateUser attaches email/password to the *same* auth.uid() — profiles,
      // memberships, and trip rows keyed by uid are preserved.
      const normalizedEmail = email.trim();
      const { error } = await supabase.auth.updateUser(
        isAnonymous ? { email: normalizedEmail, password } : { password },
      );
      if (error) throw new Error(error.message);
      // Never raw-update anonymous_expires_at from the client. The RPC only
      // clears the column when auth.users.is_anonymous is already false
      // (e.g. confirm-email already applied, or project has confirm off).
      if (isAnonymous) {
        await supabase.rpc('clear_anonymous_expiry_if_registered', {
          p_uid: uid,
        }).then(() => undefined, () => undefined);
      }

      const { data: refreshed } = await supabase.auth.getUser();
      const stillAnon = !!refreshed.user?.is_anonymous;
      setUser((prev) =>
        prev
          ? {
              ...prev,
              email: normalizedEmail || prev.email,
              // Keep server expiry until identity is actually non-anonymous.
              anonymousExpiresAt: stillAnon
                ? prev.anonymousExpiresAt
                : undefined,
              provider: stillAnon
                ? prev.provider
                : prev.provider === 'anonymous'
                  ? 'email'
                  : prev.provider,
            }
          : prev,
      );
      // Do not invent registered state while confirm-email is still pending.
      setIsAnonymous(stillAnon);
    },
    [isAnonymous, setIsAnonymous, setUser, user],
  );

  const updateNickname = useCallback(
    async (nickname: string) => {
      const next = await updateNicknameApi(nickname);
      setUser((prev) => (prev ? { ...prev, name: next } : prev));
    },
    [setUser],
  );

  const updateProfile = useCallback(
    async (fields: {
      nickname?: string;
      avatar?: string;
      avatarColor?: string;
      preferences?: AccountPreferences;
    }) => {
      // #169: profiles row is SoT — commit local session only after server write.
      // Overlay keeps its own draft; do not optimistically pollute committed avatar.
      await updateProfileApi(fields);
      const nickname = fields.nickname?.trim();
      setUser((u) =>
        u
          ? {
              ...u,
              name: nickname || u.name,
              avatar: fields.avatar ?? u.avatar,
              avatarColor: fields.avatarColor ?? u.avatarColor,
              preferences: fields.preferences ?? u.preferences,
            }
          : u,
      );
    },
    [setUser],
  );

  return {
    signIn,
    signInWithGoogle,
    signInWithApple,
    linkWithGoogle,
    linkWithApple,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    deleteAccount,
    upgradeToEmailAccount,
    updateNickname,
    updateProfile,
  };
}

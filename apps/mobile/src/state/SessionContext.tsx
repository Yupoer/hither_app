import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '../api/supabase';
import {
  updateNickname as updateNicknameApi,
  updateProfile as updateProfileApi,
} from '../api/client';
import type { Group, MemberRole, User } from '../types';

// Dismisses a leftover auth browser tab if one is still open on launch.
WebBrowser.maybeCompleteAuthSession();

/**
 * App-wide session state: who is signed in, and which group (and role)
 * they are currently in.
 *
 * Auth is Supabase **anonymous sign-in** (`signInAnonymously()`), matching the
 * MVP "anonymous nickname" model: there is no password/email step — the user
 * just picks a nickname. `User.id` is the Supabase `auth.uid()`, which RLS uses
 * to scope every row. The nickname is persisted to `public.profiles`.
 *
 * The session itself is persisted by supabase-js via AsyncStorage, so a relaunch
 * restores the signed-in anonymous user. `setMembership` tracks the current
 * group/role; the live member positions live in `useGroupState`.
 */

/** Where the user sits in the current group. `null` until they create/join one. */
export interface Membership {
  group: Group;
  role: MemberRole;
}

interface SessionContextValue {
  user: User | null;
  membership: Membership | null;
  /** True while restoring a persisted session on launch. */
  initializing: boolean;
  /**
   * Anonymously sign in and record the chosen nickname. Resolves to the User
   * (with `id === auth.uid()`). `email` is accepted for API compatibility but
   * unused in the anonymous flow.
   */
  signIn: (input: { name: string; email?: string }) => Promise<User>;
  /**
   * Sign in / register with Google via the system browser (Supabase OAuth).
   * Expo Go compatible: no native SDK — opens `signInWithOAuth`'s URL with
   * `WebBrowser` and sets the returned session. `nickname` overrides the
   * profile name; when blank the Google display name is kept/used. Resolves
   * `null` if the user cancels the browser.
   */
  signInWithGoogle: (nickname?: string) => Promise<User | null>;
  /** Sign in with an existing email + password account. */
  signInWithEmail: (input: { email: string; password: string }) => Promise<User>;
  /**
   * Register a new email + password account and record the nickname.
   * Assumes Supabase "Confirm email" is OFF so `signUp` returns a session
   * immediately; throws a clear error if no session comes back.
   */
  signUpWithEmail: (input: {
    email: string;
    password: string;
    nickname: string;
  }) => Promise<User>;
  signOut: () => Promise<void>;
  /** Change the signed-in user's nickname (persisted to `profiles`). */
  updateNickname: (nickname: string) => Promise<void>;
  /**
   * Save nickname/avatar changes in one call (persisted to `profiles`).
   * Optimistic: `user` updates immediately and reverts if the write fails.
   */
  updateProfile: (fields: { nickname?: string; avatar?: string }) => Promise<void>;
  /** Record the group the user just created (as leader) or joined (as follower). */
  setMembership: (membership: Membership) => void;
  leaveGroup: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembershipState] = useState<Membership | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Restore any persisted anonymous session on launch and keep `user.id` in
  // sync with auth state. The nickname is read back from `profiles` so a
  // relaunch shows the same identity.
  useEffect(() => {
    let active = true;

    async function hydrate(userId: string | undefined) {
      if (!userId) {
        if (active) setUser(null);
        return;
      }
      // select('*') so the optional avatar column is tolerated either way.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      const row = data as { nickname?: string; avatar?: string | null } | null;
      if (active) {
        setUser({
          id: userId,
          name: row?.nickname ?? '',
          email: '',
          avatar: row?.avatar ?? undefined,
        });
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      hydrate(data.session?.user.id).finally(() => {
        if (active) setInitializing(false);
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (active) setUser(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      membership,
      initializing,
      signIn: async ({ name }) => {
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
        return nextUser;
      },
      signInWithGoogle: async (nickname) => {
        const redirectTo = makeRedirectUri();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          // We drive the browser ourselves so it works in Expo Go / native.
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data?.url) {
          throw new Error(error?.message ?? 'Google 登入失敗');
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') return null; // dismissed / cancelled

        // Implicit flow returns the tokens in the redirect URL fragment.
        const { params, errorCode } = QueryParams.getQueryParams(result.url);
        if (errorCode) throw new Error(errorCode);
        const { access_token, refresh_token } = params;
        if (!access_token) throw new Error('Google 登入未取得憑證');

        const { data: sess, error: sessErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessErr || !sess.user) {
          throw new Error(sessErr?.message ?? 'Google 登入失敗');
        }

        const authUser = sess.user;
        const meta = authUser.user_metadata ?? {};
        // Keep any nickname the returning user already set; only fall back to
        // the Google display name (or email prefix) for a first sign-in.
        const { data: existing } = await supabase
          .from('profiles')
          .select('nickname')
          .eq('id', authUser.id)
          .maybeSingle();
        const name =
          nickname?.trim() ||
          (existing as { nickname?: string } | null)?.nickname ||
          meta.full_name ||
          meta.name ||
          authUser.email?.split('@')[0] ||
          '';

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({ id: authUser.id, nickname: name }, { onConflict: 'id' });
        if (profileError) throw new Error(profileError.message);

        const nextUser: User = {
          id: authUser.id,
          name,
          email: authUser.email ?? '',
          avatar: meta.avatar_url ?? undefined,
        };
        setUser(nextUser);
        return nextUser;
      },
      signInWithEmail: async ({ email, password }) => {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error || !data.user) {
          throw new Error(error?.message ?? 'Email 登入失敗');
        }
        const userId = data.user.id;
        // Read back the nickname/avatar this account already has.
        const { data: profile } = await supabase
          .from('profiles')
          .select('nickname, avatar')
          .eq('id', userId)
          .maybeSingle();
        const row = profile as { nickname?: string; avatar?: string | null } | null;
        const nextUser: User = {
          id: userId,
          name: row?.nickname ?? '',
          email: data.user.email ?? '',
          avatar: row?.avatar ?? undefined,
        };
        setUser(nextUser);
        return nextUser;
      },
      signUpWithEmail: async ({ email, password, nickname }) => {
        const trimmed = nickname.trim();
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw new Error(error.message);
        // With "Confirm email" ON, signUp returns no session — surface that
        // instead of silently failing the profile upsert (RLS needs the uid).
        if (!data.session || !data.user) {
          throw new Error(
            '註冊需要 Email 驗證。請在 Supabase 關閉 Confirm email，或改用驗證信流程。',
          );
        }
        const userId = data.user.id;
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({ id: userId, nickname: trimmed }, { onConflict: 'id' });
        if (profileError) throw new Error(profileError.message);
        const nextUser: User = {
          id: userId,
          name: trimmed,
          email: data.user.email ?? '',
        };
        setUser(nextUser);
        return nextUser;
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setUser(null);
        setMembershipState(null);
      },
      updateNickname: async (nickname) => {
        const next = await updateNicknameApi(nickname);
        setUser((prev) => (prev ? { ...prev, name: next } : prev));
      },
      updateProfile: async (fields) => {
        const prev = user;
        const nickname = fields.nickname?.trim();
        setUser((u) =>
          u
            ? {
                ...u,
                name: nickname || u.name,
                avatar: fields.avatar ?? u.avatar,
              }
            : u,
        );
        try {
          await updateProfileApi(fields);
        } catch (e) {
          setUser(prev);
          throw e;
        }
      },
      setMembership: (next) => setMembershipState(next),
      leaveGroup: () => setMembershipState(null),
    }),
    [user, membership, initializing],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}

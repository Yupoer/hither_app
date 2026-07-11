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
import { avatarForUser } from '../constants/avatars';
import { syncOnboardingIfNeeded } from '../onboarding/sync';
import { flushQueuedEvents } from '../utils/activityLog';

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
  /** True when the signed-in user is a Supabase anonymous (guest) account. */
  isAnonymous: boolean;
  /** Hither Pro entitlement (`profiles.pro`). Client-trusted for now. */
  isPro: boolean;
  /**
   * Anonymously sign in and record the chosen nickname. Resolves to the User
   * (with `id === auth.uid()`). `email` is accepted for API compatibility but
   * unused in the anonymous flow.
   *
   * Anonymous accounts and their data are subject to cleanup 3 days after the
   * user joins a group (server-side cleanup job not yet implemented; the join
   * timestamp lives in `memberships.created_at`).
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
  /**
   * Upgrade the signed-in anonymous account to an email + password account.
   * Uses `auth.updateUser`, which attaches email/password to the *same*
   * `auth.uid()` — profiles/memberships and every other row keyed by uid are
   * kept (per PRODUCT.md: "匿名轉註冊不得丟棄資料"). Supabase sends a
   * confirmation email; the new email only takes effect once the user clicks
   * the link inside it.
   */
  upgradeToEmailAccount: (email: string, password: string) => Promise<void>;
  /** Change the signed-in user's nickname (persisted to `profiles`). */
  updateNickname: (nickname: string) => Promise<void>;
  /**
   * Save nickname/avatar changes in one call (persisted to `profiles`).
   * Optimistic: `user` updates immediately and reverts if the write fails.
   */
  updateProfile: (fields: {
    nickname?: string;
    avatar?: string;
    avatarColor?: string;
  }) => Promise<void>;
  /** Record the group the user just created (as leader) or joined (as follower). */
  setMembership: (membership: Membership) => void;
  leaveGroup: () => void;
  /** Immediately update the local Pro status after a successful upgrade. */
  setProStatusLocal: (pro: boolean) => void;
  /** Refresh the user profile from the database (e.g. after a promo code). */
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembershipState] = useState<Membership | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isPro, setIsPro] = useState(false);

  // Restore any persisted anonymous session on launch and keep `user.id` in
  // sync with auth state. The nickname is read back from `profiles` so a
  // relaunch shows the same identity.
  useEffect(() => {
    let active = true;

    async function hydrate(authUser: { id: string; is_anonymous?: boolean; email?: string; app_metadata?: { provider?: string } } | undefined) {
      if (!authUser) {
        if (active) {
          setUser(null);
          setIsAnonymous(false);
          setIsPro(false);
        }
        return;
      }
      // select('*') so the optional avatar/pro columns are tolerated either way.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();
      const row = data as
        | {
            nickname?: string;
            avatar?: string | null;
            avatar_color?: string | null;
            pro?: boolean | null;
            created_at?: string;
            pro_plan?: string | null;
            pro_purchased_at?: string | null;
            pro_expires_at?: string | null;
          }
        | null;
      if (active) {
        setUser({
          id: authUser.id,
          name: row?.nickname ?? '',
          email: authUser.email ?? '',
          avatar: row?.avatar ?? undefined,
          avatarColor: row?.avatar_color ?? undefined,
          createdAt: row?.created_at,
          provider: authUser.app_metadata?.provider ?? (authUser.is_anonymous ? 'anonymous' : 'email'),
          proPlan: row?.pro_plan ?? undefined,
          proPurchasedAt: row?.pro_purchased_at ?? undefined,
          proExpiresAt: row?.pro_expires_at ?? undefined,
        });
        setIsAnonymous(!!authUser.is_anonymous);
        setIsPro(!!row?.pro);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      hydrate(data.session?.user).finally(() => {
        if (active) setInitializing(false);
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (active) {
          setUser(null);
          setIsAnonymous(false);
        }
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Once a session exists (any sign-in path — anonymous, email, Google, or a
  // restored launch), push any locally-completed Onboarding answers to the
  // profile exactly once. No-op if onboarding wasn't completed or was
  // already synced; never throws (see onboarding/sync.ts).
  useEffect(() => {
    if (user) {
      void syncOnboardingIfNeeded();
      flushQueuedEvents().catch(() => {});
    }
  }, [user]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      membership,
      initializing,
      isAnonymous,
      isPro,
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
        setIsAnonymous(true);
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
          .select('nickname, avatar')
          .eq('id', authUser.id)
          .maybeSingle();
        const existingRow = existing as
          | { nickname?: string; avatar?: string | null }
          | null;
        const name =
          nickname?.trim() ||
          existingRow?.nickname ||
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
          // Google's avatar_url is an HTTP URL, not an emoji — never use it here.
          // Keep a previously chosen emoji, else default one deterministically.
          avatar: existingRow?.avatar ?? avatarForUser(authUser.id),
        };
        setUser(nextUser);
        setIsAnonymous(false);
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
        setIsAnonymous(false);
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
        setIsAnonymous(false);
        return nextUser;
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setUser(null);
        setIsAnonymous(false);
        setIsPro(false);
        setMembershipState(null);
      },
      upgradeToEmailAccount: async (email, password) => {
        const { error } = await supabase.auth.updateUser({
          email: email.trim(),
          password,
        });
        if (error) throw new Error(error.message);
        // Email only takes effect once the confirmation link is clicked, so
        // don't flip isAnonymous yet — auth state (and hydrate) will reflect
        // it on the next session refresh/relaunch.
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
                avatarColor: fields.avatarColor ?? u.avatarColor,
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
      setProStatusLocal: (pro) => setIsPro(pro),
      refreshProfile: async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          const authUser = data.session.user;
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .maybeSingle();
          const row = profileData as any;
          setUser((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              name: row?.nickname ?? prev.name,
              avatar: row?.avatar ?? prev.avatar,
              avatarColor: row?.avatar_color ?? prev.avatarColor,
              createdAt: row?.created_at ?? prev.createdAt,
              provider: authUser.app_metadata?.provider ?? prev.provider,
              proPlan: row?.pro_plan ?? prev.proPlan,
              proPurchasedAt: row?.pro_purchased_at ?? prev.proPurchasedAt,
              proExpiresAt: row?.pro_expires_at ?? prev.proExpiresAt,
            };
          });
          setIsPro(!!row?.pro);
        }
      },
    }),
    [user, membership, initializing, isAnonymous, isPro],
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

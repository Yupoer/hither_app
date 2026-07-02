import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../api/supabase';
import {
  updateAvatar as updateAvatarApi,
  updateNickname as updateNicknameApi,
} from '../api/client';
import type { Group, MemberRole, User } from '../types';

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
  signOut: () => Promise<void>;
  /** Change the signed-in user's nickname (persisted to `profiles`). */
  updateNickname: (nickname: string) => Promise<void>;
  /** Change the signed-in user's emoji avatar (persisted to `profiles`). */
  updateAvatar: (avatar: string) => Promise<void>;
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
      signOut: async () => {
        await supabase.auth.signOut();
        setUser(null);
        setMembershipState(null);
      },
      updateNickname: async (nickname) => {
        const next = await updateNicknameApi(nickname);
        setUser((prev) => (prev ? { ...prev, name: next } : prev));
      },
      updateAvatar: async (avatar) => {
        const next = await updateAvatarApi(avatar);
        setUser((prev) => (prev ? { ...prev, avatar: next } : prev));
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

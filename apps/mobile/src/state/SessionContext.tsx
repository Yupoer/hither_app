import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Group, MemberRole, User } from '../types';

/**
 * App-wide session state: who is signed in, and which group (and role)
 * they are currently in.
 *
 * This is the single source of truth for `userId`, the current `group`,
 * and the user's `role` (leader / follower). Screens read it via
 * `useSession()`; the live, frequently-changing member positions are NOT
 * kept here — those come from `useGroupState`, which polls the API.
 *
 * Persistence (AsyncStorage / SecureStore for the JWT) is intentionally
 * out of scope for this MVP slice: a fresh launch starts signed-out.
 */

/** Where the user sits in the current group. `null` until they create/join one. */
export interface Membership {
  group: Group;
  role: MemberRole;
}

interface SessionContextValue {
  user: User | null;
  membership: Membership | null;
  /** Create a pseudo session from a nickname/email. No server call (MVP). */
  signIn: (input: { name: string; email?: string }) => User;
  signOut: () => void;
  /** Record the group the user just created (as leader) or joined (as follower). */
  setMembership: (membership: Membership) => void;
  leaveGroup: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/** Generate a stable-ish pseudo user id for the session. */
function makePseudoUserId(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembershipState] = useState<Membership | null>(null);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      membership,
      signIn: ({ name, email }) => {
        const trimmed = name.trim();
        const nextUser: User = {
          id: makePseudoUserId(),
          name: trimmed,
          email: email?.trim() ?? '',
        };
        setUser(nextUser);
        return nextUser;
      },
      signOut: () => {
        setUser(null);
        setMembershipState(null);
      },
      setMembership: (next) => setMembershipState(next),
      leaveGroup: () => setMembershipState(null),
    }),
    [user, membership],
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

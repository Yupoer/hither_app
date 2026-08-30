import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
} from 'react';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '../api/supabase';
import {
  updateNickname as updateNicknameApi,
  updateProfile as updateProfileApi,
  getTripEntitlement,
  getPremiumProjection,
  restoreEntitlements,
} from '../api/client';
import {
  accountPreferencesFromSlots,
  CUSTOM_QUICK_COMMAND_SLOTS,
  normalizeAccountPreferences,
  normalizeCustomQuickCommand,
  normalizeCustomQuickCommands,
  type AccountPreferences,
  type CustomQuickCommand,
  type Group,
  type MemberRole,
  type User,
} from '../types';
import {
  EMPTY_PREMIUM_PROJECTION,
  type PremiumProjection,
  type TripEntitlement,
} from '../entitlements';
import { displayMemberAvatar } from '../constants/avatars';
import { syncOnboardingIfNeeded } from '../onboarding/sync';
import { flushQueuedEvents } from '../utils/activityLog';
import { useAuthFlow } from './useAuthFlow';
import { stopBackgroundJourney } from './backgroundJourney';
import { clearLiveActivities } from './useLiveActivity';
import {
  cacheBlobToProjection,
  clearPremiumProjectionCache,
  isPremiumCacheStale,
  readPremiumProjectionCache,
  writePremiumProjectionCache,
} from '../services/premiumProjectionCache';
import { ensurePersonalPremiumAccess } from '../services/premiumPurchaseFlow';
import {
  AuthFlowError,
  type EmailSignUpResult,
  toAuthFlowError,
} from '../auth/types';

// Dismisses a leftover auth browser tab if one is still open on launch.
WebBrowser.maybeCompleteAuthSession();

const AUTH_CALLBACK_URL = 'hither://auth/callback';
const AUTH_RECOVERY_URL = 'hither://auth/recovery';

/**
 * App-wide session state: who is signed in, and which group (and role)
 * they are currently in.
 *
 * Auth supports email/password, Google, Apple, and Supabase anonymous sign-in.
 * `User.id` is the Supabase `auth.uid()`, which RLS uses to scope every row.
 * The nickname is persisted to `public.profiles`.
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

export interface SessionContextValue {
  user: User | null;
  membership: Membership | null;
  /** True while restoring a persisted session on launch. */
  initializing: boolean;
  /** True when the signed-in user is a Supabase anonymous (guest) account. */
  isAnonymous: boolean;
  /**
   * Effective premium for the current context (cache of server entitlement).
   * Must not grant access when the server reports expired/revoked/refunded/invalid.
   */
  isPro: boolean;
  /** Latest trip entitlement snapshot for the active group (cache only). */
  tripEntitlement: TripEntitlement | null;
  /** Account-owned Premium and server-computed current-team projection. */
  premiumProjection: PremiumProjection;
  /** True only after a recovery deep link has established a recovery session. */
  isPasswordRecovery: boolean;
  /** Brief success state shown before returning to the signed-in navigator. */
  passwordRecoverySuccess: boolean;
  /**
   * Anonymously sign in and record the chosen nickname. Resolves to the User
   * (with `id === auth.uid()`). `email` is accepted for API compatibility but
   * unused in the anonymous flow.
   *
   * Anonymous accounts and their data are subject to cleanup 14 days after the
   * user joins a group. Expiry is stored on `profiles.anonymous_expires_at`
   * (join timestamp on `memberships.created_at`); client messaging and server
   * authorization / cleanup use the same timestamp.
   */
  signIn: (input: { name: string; email?: string }) => Promise<User>;
  /**
   * Sign in / register with Google. iOS uses the native ID-token adapter;
   * Android and environments without that adapter use the Supabase hosted
   * OAuth browser flow. `nickname` overrides the profile name; when blank the
   * Google display name is kept/used. Resolves `null` if the user cancels.
   */
  signInWithGoogle: (nickname?: string) => Promise<User | null>;
  signInWithApple: () => Promise<User | null>;
  /** Link Google/Apple to the current anonymous account without changing its UID. */
  linkWithGoogle: () => Promise<User | null>;
  linkWithApple: () => Promise<User | null>;
  /** Sign in with an existing email + password account. */
  signInWithEmail: (input: { email: string; password: string }) => Promise<User>;
  /**
   * Register a new email + password account and record the nickname.
   * Returns a verification-pending result when Supabase requires email
   * confirmation before creating a session.
   */
  signUpWithEmail: (input: {
    email: string;
    password: string;
    nickname: string;
  }) => Promise<EmailSignUpResult>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordRecovery: (password: string) => Promise<void>;
  resendSignupConfirmation: (email: string) => Promise<void>;
  clearPasswordRecovery: () => void;
  signOut: () => Promise<void>;
  /** Permanently delete the signed-in account (anonymous or registered). */
  deleteAccount: () => Promise<void>;
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
    preferences?: AccountPreferences;
  }) => Promise<void>;
  /** Account custom shortcuts (length {@link CUSTOM_QUICK_COMMAND_SLOTS}). */
  customQuickCommands: Array<CustomQuickCommand | null>;
  /** @deprecated Prefer `customQuickCommands[0]`. */
  customQuickCommand: CustomQuickCommand | null;
  setCustomQuickCommand: (slot: number, command: CustomQuickCommand) => Promise<void>;
  /** Record the group the user just created (as leader) or joined (as follower). */
  setMembership: (membership: Membership) => void;
  leaveGroup: () => void;
  /**
   * @deprecated Do not use as proof of payment. Prefer refreshEntitlement /
   * refreshProfile after a server-validated purchase or redemption.
   */
  setProStatusLocal: (pro: boolean) => void;
  /** Refresh the user profile from the database (e.g. after a promo code). */
  refreshProfile: () => Promise<void>;
  /**
   * Re-fetch authoritative entitlement from the server for the active (or
   * given) group and update the local cache. Invalid/expired responses clear premium.
   */
  refreshEntitlement: (groupId?: string | null) => Promise<TripEntitlement | null>;
  /**
   * Premium-tap gate: missing/stale cache triggers one server refresh first.
   * Returns true when the live personal grant is entitled.
   */
  ensurePremiumAccess: () => Promise<boolean>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembershipState] = useState<Membership | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [passwordRecoverySuccess, setPasswordRecoverySuccess] = useState(false);
  const [tripEntitlement, setTripEntitlement] = useState<TripEntitlement | null>(null);
  const [premiumProjection, setPremiumProjection] = useState<PremiumProjection>(
    EMPTY_PREMIUM_PROJECTION,
  );
  const premiumUserIdRef = useRef<string | null>(null);
  // Premium UI access is derived only from the server projection. Legacy
  // profile Pro and trip-pass snapshots remain display/compatibility data and
  // cannot become an authorization signal through a local setter.
  const isPro = premiumProjection.personalPremiumActive
    || premiumProjection.teamPremiumActive;
  const setIsPro = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    () => undefined,
    [],
  );

  // Restore any persisted anonymous session on launch and keep `user.id` in
  // sync with auth state. The nickname is read back from `profiles` so a
  // relaunch shows the same identity.
  useEffect(() => {
    let active = true;

    async function hydrate(authUser: {
      id: string;
      is_anonymous?: boolean;
      email?: string;
      app_metadata?: { provider?: string };
      user_metadata?: Record<string, unknown>;
    } | undefined) {
      if (!authUser) {
        const previousId = premiumUserIdRef.current;
        premiumUserIdRef.current = null;
        if (previousId) void clearPremiumProjectionCache(previousId);
        if (active) {
          setUser(null);
          setIsAnonymous(false);
          setIsPasswordRecovery(false);
          setPasswordRecoverySuccess(false);
          setTripEntitlement(null);
          setPremiumProjection(EMPTY_PREMIUM_PROJECTION);
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
            anonymous_expires_at?: string | null;
            preferences?: unknown;
          }
        | null;
      const metadataNickname =
        typeof authUser.user_metadata?.nickname === 'string'
          ? authUser.user_metadata.nickname.trim()
          : '';
      if (!row?.nickname && metadataNickname) {
        await supabase
          .from('profiles')
          .upsert({ id: authUser.id, nickname: metadataNickname }, { onConflict: 'id' });
      }
      if (active) {
        const previousId = premiumUserIdRef.current;
        if (previousId && previousId !== authUser.id) {
          void clearPremiumProjectionCache(previousId);
        }
        premiumUserIdRef.current = authUser.id;
        const cached = await readPremiumProjectionCache(authUser.id);
        setPremiumProjection(cached ? cacheBlobToProjection(cached) : EMPTY_PREMIUM_PROJECTION);
        setTripEntitlement(null);
        setUser({
          id: authUser.id,
          name: row?.nickname ?? metadataNickname,
          email: authUser.email ?? '',
          avatar: displayMemberAvatar(row?.avatar, authUser.id, row?.avatar_color).emoji,
          avatarColor: row?.avatar_color ?? undefined,
          createdAt: row?.created_at,
          provider: authUser.app_metadata?.provider ?? (authUser.is_anonymous ? 'anonymous' : 'email'),
          pro: !!row?.pro,
          proPlan: row?.pro_plan ?? undefined,
          proPurchasedAt: row?.pro_purchased_at ?? undefined,
          proExpiresAt: row?.pro_expires_at ?? undefined,
          anonymousExpiresAt: row?.anonymous_expires_at ?? undefined,
          preferences: normalizeAccountPreferences(row?.preferences),
        });
        setIsAnonymous(!!authUser.is_anonymous);
      }
    }

    const finishInitialization = () => {
      if (active) setInitializing(false);
      // Drop orphaned lock-screen Live Activities left after a previous
      // process death (in-memory handle is gone). Map restarts them if
      // the user re-enters an active journey.
      void clearLiveActivities();
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && active) {
        setIsPasswordRecovery(true);
        setPasswordRecoverySuccess(false);
      }
      if (session && (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY')) {
        void hydrate(session.user);
      }
      if (!session) {
        const previousId = premiumUserIdRef.current;
        premiumUserIdRef.current = null;
        if (previousId) void clearPremiumProjectionCache(previousId);
        if (active) {
          setUser(null);
          setIsAnonymous(false);
          setIsPasswordRecovery(false);
          setPasswordRecoverySuccess(false);
          setTripEntitlement(null);
          setPremiumProjection(EMPTY_PREMIUM_PROJECTION);
        }
      }
    });

    const handleAuthUrl = async (url: string) => {
      try {
        const { params, errorCode } = QueryParams.getQueryParams(url);
        if (errorCode) return;
        let hasSession = false;
        if (params.code) {
          const result = await supabase.auth.exchangeCodeForSession(params.code);
          if (result.error) throw result.error;
          hasSession = Boolean(result.data.session);
        } else if (params.access_token && params.refresh_token) {
          const result = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (result.error) throw result.error;
          hasSession = Boolean(result.data.session);
        }
        if (active && params.type === 'recovery' && hasSession) {
          // Auth-js emits PASSWORD_RECOVERY for this URL. Keep this local
          // guard for React Native's explicit setSession path, which cannot
          // pass auth-js its redirect type.
          setIsPasswordRecovery(true);
          setPasswordRecoverySuccess(false);
        }
      } catch (error) {
        console.warn('[auth] deep-link session exchange failed', error);
      }
    };

    const urlSub = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void handleAuthUrl(url);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => hydrate(data.session?.user))
      .catch((error) => {
        // A missing/temporarily unavailable Keychain must not hold the whole
        // app on its splash screen. Treat restore failure as signed-out; the
        // next explicit sign-in can still establish a fresh session.
        console.warn('[auth] session restore failed; continuing signed out', error);
        if (active) {
          setUser(null);
          setIsAnonymous(false);
          setIsPro(false);
          setTripEntitlement(null);
        }
      })
      .finally(finishInitialization);

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      urlSub.remove();
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

  const {
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
  } = useAuthFlow({
    user,
    isAnonymous,
    setUser,
    setIsAnonymous,
    setIsPro,
    setMembershipState,
  });

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: AUTH_RECOVERY_URL,
    });
    if (error) throw toAuthFlowError(error, 'Password reset failed.');
  }, []);

  const completePasswordRecovery = useCallback(
    async (password: string) => {
      if (!isPasswordRecovery) {
        throw new AuthFlowError('Password recovery is not active.', 'recovery_not_active');
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw toAuthFlowError(error, 'Password update failed.');
      setIsPasswordRecovery(false);
      setPasswordRecoverySuccess(true);
    },
    [isPasswordRecovery],
  );

  const resendSignupConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: AUTH_CALLBACK_URL },
    });
    if (error) throw toAuthFlowError(error, 'Confirmation email could not be sent.');
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
    setPasswordRecoverySuccess(false);
  }, []);

  const signOutWithJourneyCleanup = useCallback(async () => {
    const previousId = premiumUserIdRef.current ?? user?.id ?? null;
    await stopBackgroundJourney().catch(() => undefined);
    await clearLiveActivities();
    await signOut();
    if (previousId) await clearPremiumProjectionCache(previousId);
    premiumUserIdRef.current = null;
    setTripEntitlement(null);
    setPremiumProjection(EMPTY_PREMIUM_PROJECTION);
    setIsPasswordRecovery(false);
    setPasswordRecoverySuccess(false);
  }, [signOut, user?.id]);

  const deleteAccountWithJourneyCleanup = useCallback(async () => {
    const previousId = premiumUserIdRef.current ?? user?.id ?? null;
    await deleteAccount();
    await stopBackgroundJourney().catch(() => undefined);
    await clearLiveActivities();
    if (previousId) await clearPremiumProjectionCache(previousId);
    premiumUserIdRef.current = null;
    setTripEntitlement(null);
    setPremiumProjection(EMPTY_PREMIUM_PROJECTION);
    setIsPasswordRecovery(false);
    setPasswordRecoverySuccess(false);
  }, [deleteAccount, user?.id]);

  const leaveGroupWithJourneyCleanup = useCallback(() => {
    void stopBackgroundJourney();
    void clearLiveActivities();
    setMembershipState(null);
    setTripEntitlement(null);
    // Drop team projection but retain account-owned Premium. Refreshing with a
    // null group keeps the personal grant visible after leaving a team.
    void getPremiumProjection(null)
      .then((projection) => {
        setPremiumProjection(projection);
      })
      .catch(() => {
        setPremiumProjection((previous) => ({
          ...previous,
          teamPremiumActive: false,
        }));
      });
  }, []);

  const refreshEntitlement = useCallback(
    async (groupId?: string | null): Promise<TripEntitlement | null> => {
      const gid = groupId ?? membership?.group.id ?? null;
      try {
        if (gid) {
          const trip = await getTripEntitlement(gid);
          setTripEntitlement(trip);
          try {
            const projection = await getPremiumProjection(gid);
            if (projection.error === 'subscription_required' && !projection.personalPremiumActive) {
              const uid = premiumUserIdRef.current;
              if (uid) await clearPremiumProjectionCache(uid);
              setPremiumProjection({
                ...projection,
                personalPremiumActive: false,
              });
            } else {
              const uid = premiumUserIdRef.current;
              if (uid) await writePremiumProjectionCache(uid, projection);
              setPremiumProjection(projection);
            }
          } catch {
            // Keep the last server projection; legacy trip state never unlocks
            // the new Premium surface when projection refresh fails.
          }
          return trip;
        }
        // Leaving a group must immediately remove the prior team projection;
        // a failed null-group refresh must not leave team access behind.
        setPremiumProjection((previous) => ({
          ...previous,
          teamPremiumActive: false,
        }));
        await restoreEntitlements(null);
        setTripEntitlement(null);
        try {
          const projection = await getPremiumProjection(null);
          if (projection.error === 'subscription_required' && !projection.personalPremiumActive) {
            const uid = premiumUserIdRef.current;
            if (uid) await clearPremiumProjectionCache(uid);
            setPremiumProjection({
              ...projection,
              personalPremiumActive: false,
              teamPremiumActive: false,
            });
          } else {
            const uid = premiumUserIdRef.current;
            if (uid) await writePremiumProjectionCache(uid, projection);
            setPremiumProjection(projection);
          }
        } catch {
          // Fail closed when there is no authoritative projection.
        }
        return null;
      } catch {
        // Network failures keep the previous cache; do not invent premium.
        return tripEntitlement;
      }
    },
    [membership?.group.id, tripEntitlement],
  );

  const ensurePremiumAccess = useCallback(async (): Promise<boolean> => {
    const uid = premiumUserIdRef.current ?? user?.id;
    if (!uid) return false;
    const cached = await readPremiumProjectionCache(uid);
    const result = await ensurePersonalPremiumAccess({
      userId: uid,
      groupId: membership?.group.id ?? null,
      cacheStale: isPremiumCacheStale(cached),
      cachedLive: cached?.isPremium === true,
    });
    if (result.allowed) {
      if (result.projection.personalPremiumActive) {
        setPremiumProjection(result.projection);
      }
      return true;
    }
    await clearPremiumProjectionCache(uid);
    setPremiumProjection({
      ...result.projection,
      personalPremiumActive: false,
    });
    return false;
  }, [user?.id, membership?.group.id]);

  const setMembership = useCallback(
    (next: Membership) => {
      setMembershipState(next);
      // Clear prior trip premium until server responds for the new group.
      setTripEntitlement(null);
      setPremiumProjection((previous) => ({
        ...previous,
        teamPremiumActive: false,
      }));
      void getTripEntitlement(next.group.id)
        .then((trip) => {
          setTripEntitlement(trip);
          return getPremiumProjection(next.group.id)
            .then(async (projection) => {
              const uid = premiumUserIdRef.current;
              if (projection.error === 'subscription_required' && !projection.personalPremiumActive) {
                if (uid) await clearPremiumProjectionCache(uid);
              } else if (uid) {
                await writePremiumProjectionCache(uid, projection);
              }
              setPremiumProjection(projection);
            })
            .catch(() => {
              // Do not use the legacy trip snapshot as a Premium fallback.
            });
        })
        .catch(() => {
          // A failed team lookup must not synthesize Premium from legacy data.
        });
    },
    [],
  );

  const customQuickCommands = useMemo(
    () => normalizeCustomQuickCommands(user?.preferences),
    [user?.preferences],
  );
  const customQuickCommand = customQuickCommands[0] ?? null;
  const setCustomQuickCommand = useCallback(
    async (slot: number, command: CustomQuickCommand) => {
      const normalized = normalizeCustomQuickCommand(command);
      if (!normalized) throw new Error('自訂快捷指令需要名稱與通知內容');
      const safeSlot = Math.max(0, Math.min(CUSTOM_QUICK_COMMAND_SLOTS - 1, slot));
      const nextSlots = [...customQuickCommands];
      nextSlots[safeSlot] = normalized;
      await updateProfile({
        preferences: {
          ...(user?.preferences ?? {}),
          ...accountPreferencesFromSlots(nextSlots),
        },
      });
    },
    [updateProfile, user?.preferences, customQuickCommands],
  );

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      const authUser = data.session.user;
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();
      const row = profileData as {
        nickname?: string;
        avatar?: string | null;
        avatar_color?: string | null;
        pro?: boolean | null;
        created_at?: string;
        pro_plan?: string | null;
        pro_purchased_at?: string | null;
        pro_expires_at?: string | null;
        anonymous_expires_at?: string | null;
        preferences?: unknown;
      } | null;
      setUser((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          name: row?.nickname ?? prev.name,
          avatar: row?.avatar ?? prev.avatar,
          avatarColor: row?.avatar_color ?? prev.avatarColor,
          createdAt: row?.created_at ?? prev.createdAt,
          provider: authUser.app_metadata?.provider ?? prev.provider,
          pro: row ? !!row.pro : prev.pro,
          proPlan: row?.pro_plan ?? prev.proPlan,
          proPurchasedAt: row?.pro_purchased_at ?? prev.proPurchasedAt,
          // Null-aware: present row with null expiry clears trip-pass denorm.
          proExpiresAt: row
            ? (row.pro_expires_at ?? undefined)
            : prev.proExpiresAt,
          // Null-aware: when the profile row is present, server null clears
          // local expiry (do not keep a stale ISO via ?? prev).
          anonymousExpiresAt: row
            ? (row.anonymous_expires_at ?? undefined)
            : prev.anonymousExpiresAt,
          preferences: normalizeAccountPreferences(row?.preferences),
        };
      });
      // Mirror server anonymous flag on every refresh (upgrade confirm, etc.).
      setIsAnonymous(!!authUser.is_anonymous);
      // Re-validate against server entitlement; do not trust profiles.pro alone.
      const gid = membership?.group.id;
      if (gid) {
        try {
          const trip = await getTripEntitlement(gid);
          setTripEntitlement(trip);
          try {
            const projection = await getPremiumProjection(gid);
            setPremiumProjection(projection);
          } catch {
            // Do not fall back to profile/trip compatibility state for Premium.
          }
        } catch {
          // Keep the last projection cache; no legacy state is an authority.
        }
      } else {
        void getPremiumProjection(null)
          .then((projection) => {
            setPremiumProjection(projection);
          })
          .catch(() => undefined);
      }
    }
  }, [membership?.group.id]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      membership,
      initializing,
      isAnonymous,
      isPro,
      tripEntitlement,
      premiumProjection,
      isPasswordRecovery,
      passwordRecoverySuccess,
      signIn,
      signInWithGoogle,
      signInWithApple,
      linkWithGoogle,
      linkWithApple,
      signInWithEmail,
      signUpWithEmail,
      requestPasswordReset,
      completePasswordRecovery,
      resendSignupConfirmation,
      clearPasswordRecovery,
      signOut: signOutWithJourneyCleanup,
      deleteAccount: deleteAccountWithJourneyCleanup,
      upgradeToEmailAccount,
      updateNickname,
      updateProfile,
      customQuickCommands,
      customQuickCommand,
      setCustomQuickCommand,
      setMembership,
      leaveGroup: leaveGroupWithJourneyCleanup,
      // Deprecated compatibility API: local writes cannot grant Premium.
      setProStatusLocal: () => undefined,
      refreshProfile,
      refreshEntitlement,
      ensurePremiumAccess,
    }),
    [
      user,
      membership,
      initializing,
      isAnonymous,
      isPro,
      tripEntitlement,
      premiumProjection,
      isPasswordRecovery,
      passwordRecoverySuccess,
      signIn,
      signInWithGoogle,
      signInWithApple,
      linkWithGoogle,
      linkWithApple,
      signInWithEmail,
      signUpWithEmail,
      requestPasswordReset,
      completePasswordRecovery,
      resendSignupConfirmation,
      clearPasswordRecovery,
      signOutWithJourneyCleanup,
      deleteAccountWithJourneyCleanup,
      upgradeToEmailAccount,
      updateNickname,
      updateProfile,
      customQuickCommands,
      customQuickCommand,
      setCustomQuickCommand,
      setMembership,
      leaveGroupWithJourneyCleanup,
      refreshProfile,
      refreshEntitlement,
      ensurePremiumAccess,
    ],
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

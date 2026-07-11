import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '../api/supabase';
import {
  updateNickname as updateNicknameApi,
  updateProfile as updateProfileApi,
} from '../api/client';
import type { User } from '../types';
import type { Membership } from './SessionContext';
import { avatarForUser } from '../constants/avatars';

export interface UseAuthFlowParams {
  user: User | null;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setIsAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPro: React.Dispatch<React.SetStateAction<boolean>>;
  setMembershipState: React.Dispatch<React.SetStateAction<Membership | null>>;
}

export function useAuthFlow({
  user,
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
      const redirectTo = makeRedirectUri();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        throw new Error(error?.message ?? 'Google 登入失敗');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return null;

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
      const { data: existing } = await supabase
        .from('profiles')
        .select('nickname, avatar')
        .eq('id', authUser.id)
        .maybeSingle();
      const existingRow = existing as { nickname?: string; avatar?: string | null } | null;
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
        avatar: existingRow?.avatar ?? avatarForUser(authUser.id),
      };
      setUser(nextUser);
      setIsAnonymous(false);
      return nextUser;
    },
    [setUser, setIsAnonymous],
  );

  const signInWithEmail = useCallback(
    async ({ email, password }: any): Promise<User> => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.user) {
        throw new Error(error?.message ?? 'Email 登入失敗');
      }
      const userId = data.user.id;
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
    [setUser, setIsAnonymous],
  );

  const signUpWithEmail = useCallback(
    async ({ email, password, nickname }: any): Promise<User> => {
      const trimmed = nickname.trim();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
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
    [setUser, setIsAnonymous],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAnonymous(false);
    setIsPro(false);
    setMembershipState(null);
  }, [setUser, setIsAnonymous, setIsPro, setMembershipState]);

  const upgradeToEmailAccount = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.updateUser({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
    },
    [],
  );

  const updateNickname = useCallback(
    async (nickname: string) => {
      const next = await updateNicknameApi(nickname);
      setUser((prev) => (prev ? { ...prev, name: next } : prev));
    },
    [setUser],
  );

  const updateProfile = useCallback(
    async (fields: { nickname?: string; avatar?: string; avatarColor?: string }) => {
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
    [user, setUser],
  );

  return {
    signIn,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    upgradeToEmailAccount,
    updateNickname,
    updateProfile,
  };
}

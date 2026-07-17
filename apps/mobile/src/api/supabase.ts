// URL/atob polyfill 必須在 supabase-js 之前載入（RN 沒有完整 URL 實作）。
import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { withSupabasePerformanceTracing } from './instrumentedSupabase';

/**
 * 單例 Supabase client，RN 端直連（不經 Vapor，Vapor 已退役）。
 *
 * 連線設定走 Expo 的 EXPO_PUBLIC_* 環境變數（apps/mobile/.env），build 時
 * 由 babel-preset-expo 注入 process.env。這裡只用 publishable（anon）key —
 * service_role 永遠不可進入 client bundle。
 *
 * Auth 用 expo-secure-store 持久化 session，確保 JWT token 安全，並自動續期 token。
 * RN 沒有 URL 導向流程，故 detectSessionInUrl 關閉。
 */

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    return SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env. 請在 apps/mobile/.env 設定 EXPO_PUBLIC_SUPABASE_URL 與 EXPO_PUBLIC_SUPABASE_ANON_KEY（見 .env.example）。',
  );
}

export const baseSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const supabase = withSupabasePerformanceTracing(baseSupabase);

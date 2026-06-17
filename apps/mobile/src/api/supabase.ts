// URL/atob polyfill 必須在 supabase-js 之前載入（RN 沒有完整 URL 實作）。
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * 單例 Supabase client，RN 端直連（不經 Vapor，Vapor 已退役）。
 *
 * 連線設定走 Expo 的 EXPO_PUBLIC_* 環境變數（apps/mobile/.env），build 時
 * 由 babel-preset-expo 注入 process.env。這裡只用 publishable（anon）key —
 * service_role 永遠不可進入 client bundle。
 *
 * Auth 用 AsyncStorage 持久化 session，並自動續期 token；RN 沒有 URL 導向流程，
 * 故 detectSessionInUrl 關閉。
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env. 請在 apps/mobile/.env 設定 EXPO_PUBLIC_SUPABASE_URL 與 EXPO_PUBLIC_SUPABASE_ANON_KEY（見 .env.example）。',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

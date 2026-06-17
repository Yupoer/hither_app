import { usePreferences, type Language } from '../state/PreferencesContext';

/**
 * Lightweight in-app i18n.
 *
 * The app shipped with mixed 中/英 strings (the design baseline). Settings now
 * lets the user pick a single language, so every user-facing string lives here
 * keyed by id, with a `zh` (繁體中文) and `en` variant. Screens read them via
 * `useTranslation()`, which resolves against the language in PreferencesContext.
 *
 * `t(key, params)` does simple `{name}`-style interpolation. Units rendered by
 * `utils/geo` (e.g. "320 m · about 4 min walk") stay as-is — they are
 * locale-neutral measurements.
 */

export type TranslationKey = keyof typeof translations.zh;

type Dict = Record<string, string>;

const zh = {
  // Common
  'common.cancel': '取消',

  // Auth
  'auth.subtitle': '一個暱稱，就能和大家一起出發',
  'auth.nameLabel': '暱稱',
  'auth.namePlaceholder': '例如：迷路的貓',
  'auth.emailLabel': 'EMAIL · 選填',
  'auth.continue': '登入',
  'auth.submitting': '登入中…',
  'auth.signInFailed': '登入失敗，請再試一次',

  // Group
  'group.greeting': '嗨，{name} 👋',
  'group.travelerFallback': '旅人',
  'group.codeLabel': '群組代碼',
  'group.roleLeaderYou': '你是隊長',
  'group.roleFollower': '你是成員',
  'group.shareHint': '把代碼分享給夥伴，他們用「加入群組」輸入即可。',
  'group.enter': '進入地圖',
  'group.leave': '離開群組',
  'group.create': '建立群組',
  'group.createSub': '隊長',
  'group.join': '加入群組',
  'group.joinSub': '成員',
  'group.nameLabel': '團名（選填）',
  'group.namePlaceholder': '例如：信義區週末小隊',
  'group.createCta': '建立並取得代碼',
  'group.codeOrIdLabel': '群組代碼或 ID',
  'group.joinCta': '加入',
  'group.chooseHint': '選擇「建立群組」當隊長，或用代碼「加入群組」當成員。',
  'group.defaultName': '{name} 的團',
  'group.createFailedTitle': '建立失敗',
  'group.createFailedMsg': '無法建立群組，請再試一次。',
  'group.joinFailedTitle': '加入失敗',
  'group.joinFailedMsg': '找不到這個群組，請確認代碼。',
  'group.codeInvalidTitle': '代碼不正確',
  'group.codeInvalidMsg': '請輸入群組代碼或 ID。',
  'group.leaveTitle': '離開群組',
  'group.leaveMsg': '確定要離開目前的群組嗎？',
  'group.leaveConfirm': '離開',

  // Settings
  'settings.accountSection': '帳號',
  'settings.preferencesSection': '偏好設定',
  'settings.groupSection': '群組',
  'settings.nickname': '暱稱',
  'settings.email': 'Email',
  'settings.language': '語言',
  'settings.theme': '主題背景',
  'settings.themeNight': '夜燈',
  'settings.themeDay': '晨光',
  'settings.themeDusk': '暮色',
  'settings.group': '群組',
  'settings.notInGroup': '尚未加入',
  'settings.code': '代碼',
  'settings.role': '角色',
  'settings.roleLeader': '隊長',
  'settings.roleFollower': '成員',
  'settings.members': '人數',
  'settings.membersValue': '{count} 人',
  'settings.leave': '離開群組',
  'settings.signOut': '登出',
  'settings.signOutTitle': '登出',
  'settings.signOutMsg': '登出後會回到登入畫面。',
  'settings.dash': '—',

  // Map
  'map.loading': '載入群組位置中…',
  'map.nextLabel': '下一集合點',
  'map.noDestinationLeader': '尚未設定集合點 · 點右上 🔍 搜尋',
  'map.noDestination': '尚未設定集合點',
  'map.calcDistance': '計算距離中…',
  'map.setFailedTitle': '設定失敗',
  'map.setFailedMsg': '無法設定集合點。請確認你是隊長，並再試一次。',
  'map.searchA11y': '搜尋下一集合點',
  'map.locateA11y': '定位到我的位置',
  'map.destinationCounter': '第 {index} / {total} 個集合點',

  // Destination search
  'search.label': '搜尋下一集合點',
  'search.placeholder': '輸入地址或地點名稱',
  'search.searching': '搜尋中…',
  'search.noResults': '找不到相符的地點',

  // Group map (web fallback)
  'web.note':
    '🗺️ 互動地圖只在原生 App 顯示（iPhone 上的 Expo Go）。\n以下為 web 預覽用的即時資料。',
  'web.membersSection': '成員 · {count}',
  'web.unknownLocation': '位置未知',
} as const;

const en: Record<keyof typeof zh, string> = {
  'common.cancel': 'Cancel',

  'auth.subtitle': 'A nickname is all you need.',
  'auth.nameLabel': 'YOUR NAME',
  'auth.namePlaceholder': 'e.g. Lost Cat',
  'auth.emailLabel': 'EMAIL · optional',
  'auth.continue': 'Continue',
  'auth.submitting': 'Signing in…',
  'auth.signInFailed': 'Sign-in failed, please try again',

  'group.greeting': 'Hi, {name} 👋',
  'group.travelerFallback': 'traveler',
  'group.codeLabel': 'GROUP CODE',
  'group.roleLeaderYou': "You're the leader",
  'group.roleFollower': "You're a member",
  'group.shareHint': 'Share the code with friends; they enter it via “Join group”.',
  'group.enter': 'Enter map',
  'group.leave': 'Leave group',
  'group.create': 'Create group',
  'group.createSub': 'Leader',
  'group.join': 'Join group',
  'group.joinSub': 'Follower',
  'group.nameLabel': 'GROUP NAME (optional)',
  'group.namePlaceholder': 'e.g. Weekend crew',
  'group.createCta': 'Create group',
  'group.codeOrIdLabel': 'GROUP CODE or ID',
  'group.joinCta': 'Join',
  'group.chooseHint':
    'Pick “Create group” to lead, or enter a code to “Join group” as a member.',
  'group.defaultName': "{name}'s group",
  'group.createFailedTitle': 'Create failed',
  'group.createFailedMsg': "Couldn't create the group, please try again.",
  'group.joinFailedTitle': 'Join failed',
  'group.joinFailedMsg': "Group not found, please check the code.",
  'group.codeInvalidTitle': 'Invalid code',
  'group.codeInvalidMsg': 'Please enter a group code or ID.',
  'group.leaveTitle': 'Leave group',
  'group.leaveMsg': 'Leave the current group?',
  'group.leaveConfirm': 'Leave',

  'settings.accountSection': 'Account',
  'settings.preferencesSection': 'Preferences',
  'settings.groupSection': 'Group',
  'settings.nickname': 'Nickname',
  'settings.email': 'Email',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.themeNight': 'Night',
  'settings.themeDay': 'Day',
  'settings.themeDusk': 'Dusk',
  'settings.group': 'Group',
  'settings.notInGroup': 'Not joined',
  'settings.code': 'Code',
  'settings.role': 'Role',
  'settings.roleLeader': 'Leader',
  'settings.roleFollower': 'Member',
  'settings.members': 'Members',
  'settings.membersValue': '{count}',
  'settings.leave': 'Leave group',
  'settings.signOut': 'Sign out',
  'settings.signOutTitle': 'Sign out',
  'settings.signOutMsg': "You'll return to the sign-in screen.",
  'settings.dash': '—',

  'map.loading': 'Loading group locations…',
  'map.nextLabel': 'NEXT GATHERING POINT',
  'map.noDestinationLeader': 'No gathering point yet · tap 🔍 top-right',
  'map.noDestination': 'No gathering point yet',
  'map.calcDistance': 'Calculating distance…',
  'map.setFailedTitle': 'Failed',
  'map.setFailedMsg': "Couldn't set the gathering point. Make sure you're the leader and try again.",
  'map.searchA11y': 'Search next gathering point',
  'map.locateA11y': 'Center on my location',
  'map.destinationCounter': 'Stop {index} of {total}',

  'search.label': 'SEARCH NEXT GATHERING POINT',
  'search.placeholder': 'Enter an address or place name',
  'search.searching': 'Searching…',
  'search.noResults': 'No matching places',

  'web.note':
    '🗺️ The interactive map only shows in the native app (Expo Go on iPhone).\nLive data below is for the web preview.',
  'web.membersSection': 'Members · {count}',
  'web.unknownLocation': 'Location unknown',
};

export const translations: Record<Language, Dict> = { zh, en };

/** Interpolate `{name}` placeholders from `params`. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export interface Translator {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  language: Language;
}

/** Resolve user-facing strings against the active language. */
export function useTranslation(): Translator {
  const { language } = usePreferences();
  const dict = translations[language];
  return {
    language,
    t: (key, params) => interpolate(dict[key] ?? translations.zh[key] ?? key, params),
  };
}

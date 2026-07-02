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
  'auth.nameLabel': '暱稱',
  'auth.namePlaceholder': '例如：迷路的貓',
  'auth.signInFailed': '登入失敗，請再試一次',

  // Role select
  'role.tagline': '讓大家不走散，隨時知道下一個集合點。',
  'role.lead': '帶領一個群組',
  'role.join': '用代碼加入',
  'role.footer': '免註冊 · 只要一個暱稱',

  // Auth (role-scoped)
  'auth.leaderKicker': '你是隊長',
  'auth.leaderTitle': '建立群組',
  'auth.leaderSub': '取一個名字，成員會在你的圖釘旁看到它。',
  'auth.leaderCta': '建立並開啟地圖',
  'auth.leaderFoot': '系統會產生一組 6 碼代碼供分享。',
  'auth.followerKicker': '加入群組',
  'auth.followerTitle': '輸入代碼',
  'auth.followerSub': '輸入你的暱稱和隊長分享的代碼。',
  'auth.followerCta': '加入並開啟地圖',
  'auth.followerFoot': '向隊長索取 6 碼群組代碼。',

  // Group
  'group.travelerFallback': '旅人',
  'group.codeLabel': '群組代碼',
  'group.leave': '離開群組',
  'group.defaultName': '{name} 的團',
  'group.createFailedTitle': '建立失敗',
  'group.joinFailedTitle': '加入失敗',
  'group.leaveTitle': '離開群組',
  'group.leaveMsg': '確定要離開目前的群組嗎？',
  'group.leaveConfirm': '離開',
  'group.copied': '已複製代碼',

  // Settings
  'settings.accountSection': '帳號',
  'settings.nickname': '暱稱',
  'settings.language': '語言',
  'settings.theme': '主題背景',
  'settings.themeNight': '夜燈',
  'settings.themeDay': '晨光',
  'settings.themeDusk': '暮色',
  'settings.roleLeader': '隊長',
  'settings.roleFollower': '成員',
  'settings.edit': '編輯',
  'settings.save': '儲存',
  'settings.nicknameFailed': '無法更新暱稱，請再試一次。',
  'settings.noDestinations': '尚未設定任何集合點。',
  'settings.reorderFailed': '無法調整順序，請確認你是隊長並再試一次。',
  'settings.deleteTitle': '刪除集合點',
  'settings.deleteMsg': '確定要刪除「{title}」嗎？',
  'settings.deleteConfirm': '刪除',
  'settings.deleteFailed': '無法刪除集合點，請確認你是隊長並再試一次。',
  'settings.signOut': '登出',
  'settings.signOutTitle': '登出',
  'settings.signOutMsg': '登出後會回到登入畫面。',

  // Map
  'map.loading': '載入群組位置中…',
  'map.setFailedTitle': '設定失敗',
  'map.setFailedMsg': '無法設定集合點。請確認你是隊長，並再試一次。',
  'map.searchA11y': '搜尋下一集合點',
  'map.locateA11y': '定位到我的位置',
  'map.destinationCounter': '第 {index} / {total} 個集合點',
  // Map · journey (start/pause) + arrival
  'map.journeyFailed': '無法更新行程狀態，請確認你是隊長並再試一次。',
  'map.arriveTitle': '接近目的地',
  'map.arriveBody': '你已接近「{title}」，要結束此目的地行程嗎？',
  'map.arriveConfirm': '結束行程',
  'map.arriveDismiss': '繼續前往',

  // Map · new design (Hither iOS Flow)
  'map.searchPlaces': '搜尋地點',
  'map.share': '分享',
  'map.copy': '複製',
  'map.shareMsg': '用代碼 {code} 加入我的 Hither 群組',
  'map.flockLabel': '成員',
  'map.gatheringPoints': '集合點',
  'map.stopsReorder': '{count} 個集合點 · 調整順序',
  'map.edit': '編輯',
  'map.cmdLeaderTitle': '快捷指令 · 給成員',
  'map.cmdFollowerTitle': '快捷請求 · 給隊長',
  'map.settingsAll': '設定與所有指令',
  'map.done': '完成',
  'map.routeHint': '拖曳右側把手可調整順序，最上面就是下一個集合點。',
  'map.addStop': '新增集合點',
  'map.directions': '導航',
  'map.viewOnMap': '在地圖上查看',
  'map.nextTag': '下一站',
  'map.overlaySettings': '設定',
  'map.endGroup': '結束群組',
  'flock.leading': '領隊中',
  'flock.arrived': '已抵達',
  'flock.enroute': '前往中',
  'flock.unknown': '位置未知',
  'flock.here': '就在這',

  // Commands (quick buttons) · labels
  'command.gather': '集合',
  'command.find_gathering': '找集合點',
  'command.depart': '出發',
  'command.rest': '休息',
  'command.be_careful': '小心',
  'command.go_left': '往左',
  'command.go_right': '往右',
  'command.stop': '停下',
  'command.hurry_up': '快一點',
  'command.need_restroom': '要上廁所',
  'command.need_break': '想休息',
  'command.need_help': '需要幫忙',
  'command.found_something': '發現東西',
  'command.sent': '已通知大家',
  'command.sendFailed': '通知傳送失敗，請再試一次。',

  // Local notification copy (received-side)
  'notif.addGatheringTitle': '新的集合點',
  'notif.addGatheringBody': '集合點：{title}',
  'notif.leaderTitle': '隊長：{label}',
  'notif.memberTitle': '成員：{label}',
  'notif.journeyGoingTitle': '出發囉',
  'notif.journeyGoingBody': '隊長已開始前往集合點',
  'notif.journeyPausedTitle': '暫停',
  'notif.journeyPausedBody': '隊長已暫停前往集合點',

  // Settings · quick notifications + per-category toggles
  'settings.quickHintLeader': '點一下即時通知所有成員。',
  'settings.quickHintFollower': '點一下即時通知隊長與其他成員。',
  'settings.notifSection': '通知設定',
  'settings.notifAddGathering': '新增集合點',
  'settings.notifLeaderCommands': '隊長指令',
  'settings.notifFollowerRequests': '成員快捷請求',
  'settings.notifJourney': '行程開始 / 暫停',

  // Destination search
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

  'auth.nameLabel': 'YOUR NAME',
  'auth.namePlaceholder': 'e.g. Lost Cat',
  'auth.signInFailed': 'Sign-in failed, please try again',

  'role.tagline': 'Keep your flock together. Always know the next gathering point.',
  'role.lead': 'Lead a group',
  'role.join': 'Join with a code',
  'role.footer': 'No account needed · just a nickname',

  'auth.leaderKicker': "You're the shepherd",
  'auth.leaderTitle': 'Create group',
  'auth.leaderSub': 'Pick a name your flock sees beside your pin.',
  'auth.leaderCta': 'Create & open map',
  'auth.leaderFoot': 'A 6-character code is generated to share.',
  'auth.followerKicker': 'Join a flock',
  'auth.followerTitle': 'Enter code',
  'auth.followerSub': 'Type your name and the code your shepherd shared.',
  'auth.followerCta': 'Join & open map',
  'auth.followerFoot': 'Ask your shepherd for the 6-character code.',

  'group.travelerFallback': 'traveler',
  'group.codeLabel': 'GROUP CODE',
  'group.leave': 'Leave group',
  'group.defaultName': "{name}'s group",
  'group.createFailedTitle': 'Create failed',
  'group.joinFailedTitle': 'Join failed',
  'group.leaveTitle': 'Leave group',
  'group.leaveMsg': 'Leave the current group?',
  'group.leaveConfirm': 'Leave',
  'group.copied': 'Code copied',

  'settings.accountSection': 'Account',
  'settings.nickname': 'Nickname',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.themeNight': 'Night',
  'settings.themeDay': 'Day',
  'settings.themeDusk': 'Dusk',
  'settings.roleLeader': 'Leader',
  'settings.roleFollower': 'Member',
  'settings.edit': 'Edit',
  'settings.save': 'Save',
  'settings.nicknameFailed': "Couldn't update nickname, please try again.",
  'settings.noDestinations': 'No gathering points yet.',
  'settings.reorderFailed': "Couldn't reorder. Make sure you're the leader and try again.",
  'settings.deleteTitle': 'Delete gathering point',
  'settings.deleteMsg': 'Delete “{title}”?',
  'settings.deleteConfirm': 'Delete',
  'settings.deleteFailed': "Couldn't delete. Make sure you're the leader and try again.",
  'settings.signOut': 'Sign out',
  'settings.signOutTitle': 'Sign out',
  'settings.signOutMsg': "You'll return to the sign-in screen.",

  'map.loading': 'Loading group locations…',
  'map.setFailedTitle': 'Failed',
  'map.setFailedMsg': "Couldn't set the gathering point. Make sure you're the leader and try again.",
  'map.searchA11y': 'Search next gathering point',
  'map.locateA11y': 'Center on my location',
  'map.destinationCounter': 'Stop {index} of {total}',
  'map.journeyFailed': "Couldn't update journey status. Make sure you're the leader and try again.",
  'map.arriveTitle': 'Approaching destination',
  'map.arriveBody': "You're near “{title}”. End this destination trip?",
  'map.arriveConfirm': 'End trip',
  'map.arriveDismiss': 'Keep going',

  'map.searchPlaces': 'Search places',
  'map.share': 'Share',
  'map.copy': 'Copy',
  'map.shareMsg': 'Join my Hither group with code {code}',
  'map.flockLabel': 'FLOCK',
  'map.gatheringPoints': 'Gathering points',
  'map.stopsReorder': '{count} stops · move & reorder',
  'map.edit': 'Edit',
  'map.cmdLeaderTitle': 'QUICK COMMANDS · TO THE FLOCK',
  'map.cmdFollowerTitle': 'QUICK REQUESTS · TO THE SHEPHERD',
  'map.settingsAll': 'Settings & all commands',
  'map.done': 'Done',
  'map.routeHint': 'Drag the handle to reorder. The top stop is where the flock heads next.',
  'map.addStop': 'Add stop',
  'map.directions': 'Directions',
  'map.viewOnMap': 'View on map',
  'map.nextTag': 'NEXT',
  'map.overlaySettings': 'Settings',
  'map.endGroup': 'End group',
  'flock.leading': 'Leading',
  'flock.arrived': 'Arrived',
  'flock.enroute': 'On the way',
  'flock.unknown': 'Location unknown',
  'flock.here': 'here',

  'command.gather': 'Gather',
  'command.find_gathering': 'Find point',
  'command.depart': 'Depart',
  'command.rest': 'Rest',
  'command.be_careful': 'Careful',
  'command.go_left': 'Go left',
  'command.go_right': 'Go right',
  'command.stop': 'Stop',
  'command.hurry_up': 'Hurry up',
  'command.need_restroom': 'Restroom',
  'command.need_break': 'Need a break',
  'command.need_help': 'Need help',
  'command.found_something': 'Found something',
  'command.sent': 'Everyone notified',
  'command.sendFailed': "Couldn't send the notification, please try again.",

  'notif.addGatheringTitle': 'New gathering point',
  'notif.addGatheringBody': 'Gathering point: {title}',
  'notif.leaderTitle': 'Leader: {label}',
  'notif.memberTitle': 'Member: {label}',
  'notif.journeyGoingTitle': "Let's go",
  'notif.journeyGoingBody': 'The leader has started heading to the gathering point',
  'notif.journeyPausedTitle': 'Paused',
  'notif.journeyPausedBody': 'The leader paused heading to the gathering point',

  'settings.quickHintLeader': 'Tap to instantly notify all members.',
  'settings.quickHintFollower': 'Tap to instantly notify the leader and others.',
  'settings.notifSection': 'Notifications',
  'settings.notifAddGathering': 'New gathering point',
  'settings.notifLeaderCommands': 'Leader commands',
  'settings.notifFollowerRequests': 'Member requests',
  'settings.notifJourney': 'Journey start / pause',

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

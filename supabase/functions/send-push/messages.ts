// Notification copy (zh — the app's default language). The server can't know
// each recipient's in-app language choice, so it sends a sensible 繁中 default;
// localizing per-user would require persisting language to the profile (future).

export interface PushPayload {
  category:
    | "add_gathering"
    | "leader_commands"
    | "follower_requests"
    | "journey"
    | "arrival"
    | "straggler"
    | "live_activity"
    | "navigation_session"
    | "location_refresh"
    | "meet_time_set"
    | "meet_time_cleared"
    | "meet_warning"
    | "meet_due"
    | "gathering_request";
  group_id: string;
  sender_id: string;
  target_user_id?: string | null;
  destination_id?: string | null;
  member_id?: string | null;
  type?: string;
  message?: string | null;
  title?: string | null;
  status?: string | null;
  session_id?: string | null;
  version?: number | null;
  /** ISO meet clock (meet_time_set / meet_warning / meet_due). */
  meet_at?: string | null;
  /** Minutes remaining (meet_warning) or red threshold (meet_time_set). */
  minutes?: number | null;
  request_id?: string | null;
  count?: number | null;
  sender_name?: string;
  /** Nickname of the member who fell behind (straggler). */
  member_name?: string;
  /** Optional distance in metres for straggler copy. */
  distance_m?: number | null;
}

const COMMAND_LABEL: Record<string, string> = {
  gather: "集合",
  find_gathering: "找集合點",
  depart: "出發",
  rest: "休息",
  be_careful: "小心",
  go_left: "往左",
  go_right: "往右",
  stop: "停下",
  hurry_up: "快一點",
  need_restroom: "要上廁所",
  need_break: "想休息",
  need_help: "需要幫忙",
  found_something: "發現東西",
  custom: "自訂指令",
};

/** Format an ISO timestamp as 月/日 時:分 in Asia/Taipei (app default locale). */
function formatMeetClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");
  if (!month || !day) return null;
  return `${month}月${day}日 ${hour}:${minute}`;
}

/** Build the alert title/body for a push payload. */
export function buildMessage(p: PushPayload): { title: string; body: string } {
  switch (p.category) {
    case "add_gathering":
      return {
        title: "新的集合點",
        body: p.title ? `集合點：${p.title}` : "隊長新增了一個集合點",
      };
    case "journey":
      if (p.status === "gathering_completed") {
        return {
          title: "集合點已完成",
          body:
            p.message?.trim() ||
            "隊長已完成此卡片，將前往下一個集合點",
        };
      }
      return p.status === "going"
        ? { title: "出發囉", body: "隊長已開始前往集合點" }
        : { title: "暫停", body: "隊長已暫停前往集合點" };
    case "arrival":
      return { title: "隊友已抵達", body: "一位隊友已抵達集合點" };
    case "straggler": {
      const name = p.member_name?.trim();
      return {
        title: "隊友已脫隊",
        body: name ? `${name} 已脫隊` : "一位隊友已離開主隊伍",
      };
    }
    case "live_activity":
      return { title: "Hither", body: "集合進度已更新" };
    case "navigation_session":
      return p.status === "active"
        ? { title: "開始集合導航", body: "隊長已開始前往集合點" }
        : { title: "集合導航已結束", body: "這次集合導航已結束" };
    case "location_refresh":
      return { title: "Hither", body: "" };
    case "meet_time_set": {
      const clock = formatMeetClock(p.meet_at);
      const place = p.title ? `「${p.title}」` : "集合點";
      return {
        title: "集合時間已設定",
        body: clock
          ? `${place} ${clock} 集合`
          : `${place} 集合時間已更新`,
      };
    }
    case "meet_time_cleared":
      return {
        title: "集合時間已清除",
        body: p.title ? `「${p.title}」的集合時間已取消` : "集合時間已取消",
      };
    case "meet_warning": {
      const mins = typeof p.minutes === "number" ? p.minutes : null;
      const place = p.title ? `「${p.title}」` : "集合點";
      return {
        title: "集合時間快到了",
        body: mins != null
          ? `${place} 還剩 ${mins} 分鐘集合`
          : `${place} 集合時間快到了`,
      };
    }
    case "meet_due": {
      const place = p.title ? `「${p.title}」` : "集合點";
      return {
        title: "集合時間到了",
        body: `該前往${place}集合了`,
      };
    }
    case "gathering_request": {
      const count = typeof p.count === "number" ? p.count : 1;
      return {
        title: "集合點加入請求",
        body: `${p.sender_name ?? "隊員"}請求加入${count > 1 ? `${count} 個` : ""}集合點`,
      };
    }
    case "leader_commands": {
      // Role prefix (隊長), not nickname/user id — matches in-app local copy.
      const label = p.type === "custom"
        ? (p.message?.trim() || COMMAND_LABEL.custom || "指令")
        : ((p.type && COMMAND_LABEL[p.type]) || "指令");
      return { title: `隊長：${label}`, body: p.message?.trim() || label };
    }
    case "follower_requests": {
      const label = p.type === "custom"
        ? (p.message?.trim() || COMMAND_LABEL.custom || "請求")
        : ((p.type && COMMAND_LABEL[p.type]) || "請求");
      return { title: `成員：${label}`, body: p.message?.trim() || label };
    }
    default:
      return { title: "Hither", body: p.message ?? "" };
  }
}

/** The notification_preferences column that gates this category. */
export function prefColumn(category: PushPayload["category"]): string {
  switch (category) {
    case "add_gathering":
      return "add_gathering";
    case "leader_commands":
      return "leader_commands";
    case "follower_requests":
      return "follower_requests";
    case "journey":
    case "arrival":
    case "straggler":
    case "live_activity":
    case "navigation_session":
    case "location_refresh":
    case "meet_time_set":
    case "meet_time_cleared":
    case "meet_warning":
    case "meet_due":
      return "journey";
    case "gathering_request":
      return "follower_requests";
  }
}

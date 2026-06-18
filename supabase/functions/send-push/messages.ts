// Notification copy (zh — the app's default language). The server can't know
// each recipient's in-app language choice, so it sends a sensible 繁中 default;
// localizing per-user would require persisting language to the profile (future).

export interface PushPayload {
  category: "add_gathering" | "leader_commands" | "follower_requests" | "journey";
  group_id: string;
  sender_id: string;
  type?: string;
  message?: string | null;
  title?: string | null;
  status?: string | null;
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
};

/** Build the alert title/body for a push payload. */
export function buildMessage(p: PushPayload): { title: string; body: string } {
  switch (p.category) {
    case "add_gathering":
      return {
        title: "新的集合點",
        body: p.title ? `集合點：${p.title}` : "隊長新增了一個集合點",
      };
    case "journey":
      return p.status === "going"
        ? { title: "出發囉", body: "隊長已開始前往集合點" }
        : { title: "暫停", body: "隊長已暫停前往集合點" };
    case "leader_commands": {
      const label = (p.type && COMMAND_LABEL[p.type]) || "指令";
      return { title: `隊長：${label}`, body: p.message ?? label };
    }
    case "follower_requests": {
      const label = (p.type && COMMAND_LABEL[p.type]) || "請求";
      return { title: `成員：${label}`, body: p.message ?? label };
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
      return "journey";
  }
}

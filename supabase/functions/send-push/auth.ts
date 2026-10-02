/** Constant-work comparison for the database-to-Edge webhook shared secret. */
export function secureEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let difference = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

/** Reject stale or misclassified command webhooks before provider fan-out. */
export function commandSenderIsAuthorized(
  payload: { category: string; type?: string },
  role: string,
): boolean {
  if (payload.category !== "leader_commands" && payload.category !== "follower_requests") return true;
  const request = ["need_restroom", "need_break", "need_help", "found_something", "request_start"].includes(payload.type ?? "");
  if (payload.category === "follower_requests") return request || (payload.type === "custom" && role !== "leader");
  // v3 classifies a leader's request by sender role; the table trigger classifies by type.
  return role === "leader" && (request || ["gather", "find_gathering", "depart", "rest", "be_careful", "go_left", "go_right", "stop", "hurry_up", "custom"].includes(payload.type ?? ""));
}

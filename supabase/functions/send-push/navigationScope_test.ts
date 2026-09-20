import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { navigationScopeMembers } from "./recipients.ts";

Deno.test("parallel main/subgroup navigation controls never cross scopes", () => {
  const members = [
    { user_id: "main", subgroup_id: null },
    { user_id: "legacy-main" },
    { user_id: "a", subgroup_id: "subgroup-a" },
    { user_id: "b", subgroup_id: "subgroup-b" },
  ];
  assertEquals(navigationScopeMembers(members, null).map(m => m.user_id), ["main", "legacy-main"]);
  assertEquals(navigationScopeMembers(members, "subgroup-a").map(m => m.user_id), ["a"]);
  assertEquals(navigationScopeMembers(members, "deleted"), []);
});

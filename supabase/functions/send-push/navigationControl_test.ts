import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBackgroundLocationRefreshRequest } from "./apns.ts";
Deno.test("navigation control uses a silent background payload and preserves legacy refresh category",()=>{
 const cfg={key:"",keyId:"test",teamId:"test",bundleId:"test.hither",env:"sandbox" as const};
 const navigation=buildBackgroundLocationRefreshRequest(cfg,"test","device",{category:"navigation_session",groupId:"g"});
 assertEquals(JSON.parse(String(navigation.init.body)),{aps:{"content-available":1},category:"navigation_session",groupId:"g"});
 assertEquals(new Headers(navigation.init.headers).get("apns-priority"),"5");
 assertEquals(new Headers(navigation.init.headers).get("apns-push-type"),"background");
 const refresh=buildBackgroundLocationRefreshRequest(cfg,"test","device",{groupId:"g"});
 assertEquals(JSON.parse(String(refresh.init.body)).category,"location_refresh");
});

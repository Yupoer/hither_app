import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deadTokens,
  deliverProvider,
  deliveryStatus,
  emptyReport,
  mergeReports,
  summarizeDelivery,
} from "./delivery.ts";

const ok = (token: string) => Promise.resolve({ token, status: 200, dead: false });

Deno.test("FCM setup failure keeps APNs deliveries and answers 200", async () => {
  const report = mergeReports(
    await deliverProvider("apns", ["ios-1", "ios-2"], async () => ok),
    await deliverProvider("fcm", ["android-1"], () => Promise.reject(new Error("Missing FCM config"))),
  );

  assertEquals(summarizeDelivery(report), { sent: 2, apnsSent: 2, fcmSent: 0, rejected: 0, failed: 1 });
  assertEquals(report.failures, [{ provider: "fcm", recipients: 1, error: "Missing FCM config" }]);
  assertEquals(deliveryStatus(report), 200);
});

Deno.test("one thrown send fails only that recipient", async () => {
  const report = await deliverProvider("apns", ["a", "b", "c"], async () => (token) =>
    token === "b" ? Promise.reject(new Error("network down")) : ok(token));

  assertEquals(report.results.map((result) => result.token), ["a", "c"]);
  assertEquals(report.failures, [{ provider: "apns", recipients: 1, error: "network down" }]);
  assertEquals(deliveryStatus(report), 200);
});

Deno.test("provider rejections count as attempted and keep dead-token pruning", async () => {
  const report = await deliverProvider("apns", ["live", "gone"], async () => (token) =>
    Promise.resolve({ token, status: token === "gone" ? 410 : 200, dead: token === "gone" }));

  assertEquals(summarizeDelivery(report).rejected, 1);
  assertEquals(deadTokens(report), ["gone"]);
  assertEquals(deliveryStatus(report), 200);
});

Deno.test("500 only when every provider failed before any request was answered", async () => {
  const report = mergeReports(
    await deliverProvider("apns", ["ios-1"], () => Promise.reject(new Error("APNs key missing"))),
    await deliverProvider("fcm", ["android-1"], () => Promise.reject(new Error("FCM oauth 500"))),
  );

  assertEquals(summarizeDelivery(report).failed, 2);
  assertEquals(deliveryStatus(report), 500);
  assertEquals(deliveryStatus(emptyReport()), 200);
});

Deno.test("skipped recipients and empty batches never call the provider", async () => {
  let prepared = 0;
  const empty = await deliverProvider("fcm", [], async () => {
    prepared += 1;
    return ok;
  });
  const skipped = await deliverProvider("apns", ["stale"], async () => () => Promise.resolve(null));

  assertEquals(prepared, 0);
  assertEquals(empty, emptyReport());
  assertEquals(skipped, emptyReport());
});

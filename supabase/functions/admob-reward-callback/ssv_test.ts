import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_AD_UNITS,
  __resetSsvKeyCacheForTests,
  bytesToBase64Url,
  derEcdsaSignatureToP1363,
  getGoogleSsvKeysCached,
  latencyBucketMs,
  parseSsvQueryString,
  platformFromAdUnit,
  p1363EcdsaSignatureToDer,
  signatureToP1363,
  verifySsvCallback,
  type SsvKeysPayload,
} from "./ssv.ts";
import { handleAdmobRewardRequest } from "./index.ts";

const IOS_UNIT = "ca-app-pub-8135109277557342/7899053731";
const ANDROID_UNIT = "ca-app-pub-8135109277557342/7100977386";

Deno.test("allow-list contains only the two production rewarded units", () => {
  assertEquals(ALLOWED_AD_UNITS.has(IOS_UNIT), true);
  assertEquals(ALLOWED_AD_UNITS.has(ANDROID_UNIT), true);
  assertEquals(ALLOWED_AD_UNITS.size, 2);
  assertEquals(platformFromAdUnit(IOS_UNIT), "ios");
  assertEquals(platformFromAdUnit(ANDROID_UNIT), "android");
  assertEquals(platformFromAdUnit("other"), null);
});

Deno.test("parseSsvQueryString extracts content before signature", () => {
  const qs =
    "ad_network=1&ad_unit=" + IOS_UNIT +
    "&custom_data=abc123sessionref&reward_amount=1&reward_item=hither_token" +
    "&timestamp=1&transaction_id=txn1&signature=MEUCIQfake&key_id=42";
  const parsed = parseSsvQueryString(qs);
  assertExists(parsed);
  assertEquals(
    parsed!.contentToVerify,
    "ad_network=1&ad_unit=" + IOS_UNIT +
      "&custom_data=abc123sessionref&reward_amount=1&reward_item=hither_token" +
      "&timestamp=1&transaction_id=txn1",
  );
  assertEquals(parsed!.keyId, 42);
  assertEquals(parsed!.adUnit, IOS_UNIT);
  assertEquals(parsed!.customData, "abc123sessionref");
  assertEquals(parsed!.rewardAmount, "1");
  assertEquals(parsed!.rewardItem, "hither_token");
  assertEquals(parsed!.transactionId, "txn1");
});

Deno.test("DER ECDSA ↔ P1363 round-trip for P-256 components", () => {
  // r and s with high bits set → DER needs leading 0x00 padding.
  const raw = new Uint8Array(64);
  raw[0] = 0x80;
  raw[31] = 0x01;
  raw[32] = 0x90;
  raw[63] = 0x02;
  const der = p1363EcdsaSignatureToDer(raw);
  assertEquals(der[0], 0x30);
  const back = derEcdsaSignatureToP1363(der);
  assertEquals(back.length, 64);
  assertEquals(Array.from(back), Array.from(raw));
});

Deno.test("signatureToP1363 accepts DER and raw 64-byte forms", () => {
  const raw = new Uint8Array(64);
  for (let i = 0; i < 64; i++) raw[i] = i + 1;
  const der = p1363EcdsaSignatureToDer(raw);
  assertEquals(Array.from(signatureToP1363(der)), Array.from(raw));
  assertEquals(Array.from(signatureToP1363(raw)), Array.from(raw));
});

Deno.test("verifySsvCallback happy path with Web Crypto key + DER signature", async () => {
  __resetSsvKeyCacheForTests();
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const publicKeyB64 = bytesToBase64Url(spki);

  const content =
    "ad_network=1&ad_unit=" + IOS_UNIT +
    "&custom_data=sessionref12345678&reward_amount=1&reward_item=hither_token" +
    "&timestamp=1&transaction_id=txn-happy";
  const data = new TextEncoder().encode(content);
  // Web Crypto signs IEEE P1363; Google sends DER — convert for realism.
  const p1363 = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data),
  );
  const der = p1363EcdsaSignatureToDer(p1363);
  const sigB64 = bytesToBase64Url(der);
  const qs = content + "&signature=" + sigB64 + "&key_id=7";

  const keys: SsvKeysPayload = {
    keys: [{ keyId: 7, base64: publicKeyB64 }],
  };
  const result = await verifySsvCallback(qs, { keys });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.parsed.transactionId, "txn-happy");
    assertEquals(result.parsed.adUnit, IOS_UNIT);
  }
});

Deno.test("handler credits once after successful verify (injected key + credit)", async () => {
  __resetSsvKeyCacheForTests();
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const publicKeyB64 = bytesToBase64Url(spki);

  const content =
    "ad_network=1&ad_unit=" + IOS_UNIT +
    "&custom_data=sessionref12345678&reward_amount=1&reward_item=hither_token" +
    "&timestamp=1&transaction_id=txn-credit-1";
  const data = new TextEncoder().encode(content);
  const p1363 = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data),
  );
  const qs = content + "&signature=" + bytesToBase64Url(p1363EcdsaSignatureToDer(p1363)) +
    "&key_id=9";

  let calls = 0;
  const credit = async (args: {
    session_ref: string;
    google_transaction_id: string;
    ad_unit: string;
    reward_amount: string;
    reward_item: string;
  }) => {
    calls += 1;
    assertEquals(args.session_ref, "sessionref12345678");
    assertEquals(args.google_transaction_id, "txn-credit-1");
    assertEquals(args.ad_unit, IOS_UNIT);
    assertEquals(args.reward_amount, "1");
    assertEquals(args.reward_item, "hither_token");
    return calls === 1
      ? { ok: true, already_credited: false, balance: 1 }
      : { ok: true, already_credited: true, balance: 1 };
  };

  const req = new Request(
    "https://example.test/functions/v1/admob-reward-callback?" + qs,
  );
  const res = await handleAdmobRewardRequest(req, {
    keys: undefined,
    fetchKeys: async () => ({ keys: [{ keyId: 9, base64: publicKeyB64 }] }),
    credit,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.already_credited, false);
  assertEquals(calls, 1);

  // Replay same callback → credit dep returns already_credited; still 200.
  const res2 = await handleAdmobRewardRequest(req, {
    fetchKeys: async () => ({ keys: [{ keyId: 9, base64: publicKeyB64 }] }),
    credit,
  });
  assertEquals(res2.status, 200);
  const body2 = await res2.json();
  assertEquals(body2.ok, true);
  assertEquals(body2.already_credited, true);
  assertEquals(calls, 2);
});

Deno.test("verifySsvCallback rejects unknown key without calling crypto", async () => {
  const keys: SsvKeysPayload = {
    keys: [{ keyId: 1, base64: "AAAA" }],
  };
  const qs =
    "ad_unit=" + IOS_UNIT +
    "&custom_data=sessionref12345678&reward_amount=1&reward_item=hither_token" +
    "&transaction_id=t1&signature=AA&key_id=999";
  const result = await verifySsvCallback(qs, { keys });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, "unknown_key");
});

Deno.test("verifySsvCallback rejects malformed query", async () => {
  const result = await verifySsvCallback("foo=bar", {
    keys: { keys: [{ keyId: 1, base64: "AA" }] },
  });
  assertEquals(result.ok, false);
});

Deno.test("latencyBucketMs buckets", () => {
  assertEquals(latencyBucketMs(50), "lt_100");
  assertEquals(latencyBucketMs(200), "lt_500");
  assertEquals(latencyBucketMs(1000), "lt_2s");
  assertEquals(latencyBucketMs(5000), "lt_10s");
  assertEquals(latencyBucketMs(20000), "gte_10s");
});

Deno.test("key cache returns stale keys when fetch fails after warm", async () => {
  __resetSsvKeyCacheForTests();
  let fetches = 0;
  const good: SsvKeysPayload = { keys: [{ keyId: 1, base64: "good" }] };
  const first = await getGoogleSsvKeysCached(async () => {
    fetches += 1;
    return good;
  }, () => 1_000);
  assertEquals(first.keys[0]!.base64, "good");
  assertEquals(fetches, 1);

  // Within TTL → no re-fetch
  const second = await getGoogleSsvKeysCached(async () => {
    fetches += 1;
    throw new Error("should_not_run");
  }, () => 1_000 + 60_000);
  assertEquals(second.keys[0]!.base64, "good");
  assertEquals(fetches, 1);

  // Past TTL, fetch fails → stale fallback
  const third = await getGoogleSsvKeysCached(async () => {
    fetches += 1;
    throw new Error("network");
  }, () => 1_000 + 7 * 60 * 60 * 1000);
  assertEquals(third.keys[0]!.base64, "good");
  assertEquals(fetches, 2);
});

Deno.test("handler rejects missing signature query", async () => {
  const req = new Request("https://example.test/functions/v1/admob-reward-callback");
  const res = await handleAdmobRewardRequest(req, {
    fetchKeys: async () => ({ keys: [] }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
});

Deno.test("handler rejects invalid ad unit after signature fail path", async () => {
  const qs =
    "ad_unit=ca-app-pub-0000000000000000/0000000000" +
    "&custom_data=sessionref12345678&reward_amount=1&reward_item=hither_token" +
    "&transaction_id=t1&signature=MEUCIQ&key_id=1";
  const req = new Request(
    "https://example.test/functions/v1/admob-reward-callback?" + qs,
  );
  const res = await handleAdmobRewardRequest(req, {
    fetchKeys: async () => ({ keys: [{ keyId: 2, base64: "AA" }] }),
  });
  assertEquals(res.status, 400);
});

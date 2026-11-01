import { handleGoogleMapsRequest } from "./handler.ts";

Deno.test("Google Maps proxy never invokes billable search or routes", async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = (() => {
    outboundCalls += 1;
    throw new Error("Unexpected outbound request");
  }) as typeof fetch;
  try {
    for (const action of ["search", "route"]) {
      const response = handleGoogleMapsRequest(
        new Request("http://localhost/google-maps", {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      );
      if (
        response.status !== 503 ||
        (await response.json()).error !== "upstream_unavailable"
      ) {
        throw new Error(`Expected ${action} to be disabled`);
      }
      if (response.headers.get("Cache-Control") !== "no-store") {
        throw new Error("Disabled response must not be cached");
      }
    }
    if (outboundCalls !== 0) {
      throw new Error("Disabled Google Maps proxy made an outbound request");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  const getResponse = handleGoogleMapsRequest(
    new Request("http://localhost/google-maps"),
  );
  if (getResponse.status !== 405) {
    throw new Error("Non-POST request must be rejected");
  }
});

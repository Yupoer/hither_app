export function handleGoogleMapsRequest(request: Request): Response {
  const allowedMethod = request.method === "POST";
  return new Response(
    JSON.stringify({
      error: allowedMethod ? "upstream_unavailable" : "method not allowed",
    }),
    {
      status: allowedMethod ? 503 : 405,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

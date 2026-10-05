/** Normalize temporary refresh failures for auth-js. Older/current SDKs treat
 * several transient HTTP statuses as terminal AuthApiError after JWT expiry.
 * A transport rejection uses their existing retry/backoff path and preserves
 * the rotating credential. Other endpoints keep their original responses.
 */
export function withRetryableAuthRefresh(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/auth\/v1\/token\?/.test(url) || !url.includes('grant_type=refresh_token')) return response;
    const sdkRetryable = response.status >= 500 && response.status <= 504
      || response.status >= 520 && response.status <= 530;
    if (sdkRetryable) return response;
    const retryableStatus = [408, 409, 429].includes(response.status)
      || response.status >= 500 && response.status <= 599;
    let retryableCode = false;
    if (!response.ok && !retryableStatus) {
      try {
        const body = await response.clone().json();
        retryableCode = (body.code ?? body.error_code) === 'request_timeout';
      } catch { /* Preserve the SDK's handling of malformed responses. */ }
    }
    if (retryableStatus || retryableCode) {
      throw Object.assign(new Error('Authentication temporarily unavailable'), { status: response.status });
    }
    return response;
  };
}

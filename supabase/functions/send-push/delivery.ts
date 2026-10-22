export type Provider = "apns" | "fcm";

export interface SendOutcome {
  token: string;
  status: number;
  dead: boolean;
}

export interface DeliveryResult extends SendOutcome {
  provider: Provider;
}

export interface ProviderFailure {
  provider: Provider;
  recipients: number;
  error: string;
}

export interface DeliveryReport {
  results: DeliveryResult[];
  failures: ProviderFailure[];
}

export const emptyReport = (): DeliveryReport => ({ results: [], failures: [] });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Send one provider's batch. A setup failure (missing config, auth token
 * exchange) fails only this provider's recipients, and a thrown send fails
 * only that recipient. `send` returns null for a recipient it skips.
 */
export async function deliverProvider<T>(
  provider: Provider,
  items: readonly T[],
  prepare: () => Promise<(item: T) => Promise<SendOutcome | null>>,
): Promise<DeliveryReport> {
  if (items.length === 0) return emptyReport();
  let send: (item: T) => Promise<SendOutcome | null>;
  try {
    send = await prepare();
  } catch (error) {
    return { results: [], failures: [{ provider, recipients: items.length, error: message(error) }] };
  }

  const settled = await Promise.allSettled(items.map((item) => send(item)));
  const results: DeliveryResult[] = [];
  let failed = 0;
  let firstError = "";
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      failed += 1;
      firstError ||= message(outcome.reason);
    } else if (outcome.value) {
      results.push({ ...outcome.value, provider });
    }
  }
  return {
    results,
    failures: failed > 0 ? [{ provider, recipients: failed, error: firstError }] : [],
  };
}

export function mergeReports(...reports: DeliveryReport[]): DeliveryReport {
  return {
    results: reports.flatMap((report) => report.results),
    failures: reports.flatMap((report) => report.failures),
  };
}

export function deadTokens(report: DeliveryReport): string[] {
  return report.results.filter((result) => result.dead).map((result) => result.token);
}

export function summarizeDelivery(report: DeliveryReport) {
  const apnsSent = report.results.filter((r) => r.provider === "apns" && r.status === 200).length;
  const fcmSent = report.results.filter((r) => r.provider === "fcm" && r.status === 200).length;
  const sent = apnsSent + fcmSent;
  return {
    sent,
    apnsSent,
    fcmSent,
    rejected: report.results.length - sent,
    failed: report.failures.reduce((total, failure) => total + failure.recipients, 0),
  };
}

/** 500 only when recipients existed and no provider accepted a single request. */
export function deliveryStatus(report: DeliveryReport): 200 | 500 {
  return report.results.length === 0 && report.failures.length > 0 ? 500 : 200;
}

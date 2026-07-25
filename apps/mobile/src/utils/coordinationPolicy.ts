/**
 * Pure OTA-09 resolution policy — mirrors public.coordination_compute_outcome.
 * Unanswered members are never treated as consent or rejection.
 * Ineligible responses are filtered out before tallying.
 */

import type {
  CoordinationPolicy,
  CoordinationResolutionSource,
} from '../types';

export type { CoordinationPolicy, CoordinationResolutionSource };

export interface CoordinationPolicyResponse {
  userId: string;
  /** Present only when the member has answered; unanswered = no entry. */
  optionId: string;
}

export interface CoordinationPolicyInput {
  policy: CoordinationPolicy;
  defaultOutcome: string;
  /** Members eligible to respond (group or subgroup scope). */
  eligibleUserIds: string[];
  /** Only actual responses — no synthetic null rows. May include stray ids. */
  responses: CoordinationPolicyResponse[];
}

export interface CoordinationPolicyResult {
  optionId: string;
  source: Exclude<CoordinationResolutionSource, 'cancelled'>;
}

/**
 * Compute the closed outcome for a coordination request at deadline
 * (or when evaluating the same rules offline).
 */
export function computeCoordinationOutcome(
  input: CoordinationPolicyInput,
): CoordinationPolicyResult {
  const { policy, defaultOutcome, eligibleUserIds } = input;
  const eligible = new Set(eligibleUserIds);
  // Defense-in-depth: ignore votes from users outside the eligible set.
  const responses = input.responses.filter((r) => eligible.has(r.userId));

  if (policy === 'timeout_default' || policy === 'organizer_override') {
    return { optionId: defaultOutcome, source: 'timeout_default' };
  }

  if (policy === 'unanimity') {
    if (responses.length === 0) {
      return { optionId: defaultOutcome, source: 'timeout_default' };
    }
    const first = responses[0]!.optionId;
    const conflicting = responses.some((r) => r.optionId !== first);
    if (conflicting) {
      return { optionId: defaultOutcome, source: 'timeout_default' };
    }
    const responded = new Set(responses.map((r) => r.userId));
    const allResponded =
      eligibleUserIds.length > 0
      && eligibleUserIds.every((id) => responded.has(id));
    if (allResponded) {
      return { optionId: first, source: 'unanimity' };
    }
    // Partial silence is not consent — fall back to default.
    return { optionId: defaultOutcome, source: 'timeout_default' };
  }

  if (policy === 'majority') {
    if (responses.length === 0) {
      return { optionId: defaultOutcome, source: 'timeout_default' };
    }
    const counts = new Map<string, number>();
    for (const r of responses) {
      counts.set(r.optionId, (counts.get(r.optionId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    let tie = false;
    for (const [opt, count] of counts) {
      if (count > bestCount) {
        best = opt;
        bestCount = count;
        tie = false;
      } else if (count === bestCount) {
        tie = true;
      }
    }
    // Strict majority among eligible responders only (unanswered excluded).
    if (!tie && best != null && bestCount > responses.length / 2) {
      return { optionId: best, source: 'majority' };
    }
    return { optionId: defaultOutcome, source: 'timeout_default' };
  }

  return { optionId: defaultOutcome, source: 'timeout_default' };
}

/** True when a member has no response row — neither yes nor no. */
export function isUnanswered(
  responses: CoordinationPolicyResponse[],
  userId: string,
): boolean {
  return !responses.some((r) => r.userId === userId);
}

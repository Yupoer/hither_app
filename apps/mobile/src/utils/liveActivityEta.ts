/** A coherent ETA/sample pair; unchanged or sticky estimates keep their deadline. */
export interface EtaSnapshot {
  key: string;
  etaSeconds: number;
  sampledAtMs: number;
  etaTargetAtMs: number;
}

export function resolveEtaSnapshot(previous: EtaSnapshot | null, input: {
  key: string; etaSeconds: number | null | undefined; sampledAtMs?: number;
  nowMs: number; fresh?: boolean;
}): EtaSnapshot | null {
  if (input.etaSeconds == null || !Number.isFinite(input.etaSeconds)) return null;
  if (previous && (previous.key === input.key || input.fresh === false)) return previous;
  if (!previous && input.fresh === false) return null;
  const sampledAtMs = input.sampledAtMs != null && Number.isFinite(input.sampledAtMs)
    ? input.sampledAtMs : input.nowMs;
  const etaSeconds = Math.max(0, input.etaSeconds);
  return { key: input.key, etaSeconds, sampledAtMs, etaTargetAtMs: sampledAtMs + etaSeconds * 1000 };
}

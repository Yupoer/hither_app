/** RPC sequence is a non-negative bigint; GPS timestamps may include fractions. */
export function normalizeLocationSequence(value: number): number {
  const sequence = Math.trunc(value);
  if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(sequence)) {
    throw new RangeError('invalid_location_sequence');
  }
  return sequence;
}

/** Constant-work comparison for the database-to-Edge webhook shared secret. */
export function secureEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let difference = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

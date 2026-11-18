export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 20;

const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);
const LEGACY_INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeInviteCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_CODE_LENGTH);
}

export function isValidInviteCode(value: string): boolean {
  // Clients may update before the database rotates the legacy codes.
  return INVITE_CODE_PATTERN.test(value) || LEGACY_INVITE_CODE_PATTERN.test(value);
}

export function formatInviteCode(value: string): string {
  if (LEGACY_INVITE_CODE_PATTERN.test(value)) return `${value.slice(0, 3)}-${value.slice(3)}`;
  return value.match(/.{1,5}/g)?.join('-') ?? value;
}

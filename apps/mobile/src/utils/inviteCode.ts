export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;

const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);

export function normalizeInviteCode(value: string): string {
  return value
    .toUpperCase()
    .replace(new RegExp(`[^${INVITE_CODE_ALPHABET}]`, 'g'), '')
    .slice(0, INVITE_CODE_LENGTH);
}

export function isValidInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(value);
}

export function formatInviteCode(value: string): string {
  return value.length > 3 ? `${value.slice(0, 3)}-${value.slice(3)}` : value;
}

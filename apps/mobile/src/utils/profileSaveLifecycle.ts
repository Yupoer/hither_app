/**
 * Pure lifecycle for profile overlay save (#169).
 * Overlay draft is local-only; session/group projection commits only after
 * server-confirmed success. Failure keeps draft and never closes.
 */

export type ProfileSavePhase = 'draft' | 'saving' | 'success' | 'error';

export type ProfileSaveFields = {
  nickname?: string;
  avatar?: string;
  avatarColor?: string;
};

export type ProfileCommitted = {
  name?: string | null;
  avatar?: string | null;
  avatarColor?: string | null;
};

/** Diff draft against last server-confirmed profile. Empty → no write. */
export function buildProfileSaveFields(
  draft: { name: string; avatar?: string; color?: string },
  committed: ProfileCommitted,
): ProfileSaveFields {
  const fields: ProfileSaveFields = {};
  const nickname = draft.name.trim();
  if (nickname && nickname !== (committed.name ?? '')) fields.nickname = nickname;
  if (draft.avatar && draft.avatar !== (committed.avatar ?? undefined)) {
    fields.avatar = draft.avatar;
  }
  if (draft.color && draft.color !== (committed.avatarColor ?? undefined)) {
    fields.avatarColor = draft.color;
  }
  return fields;
}

export function hasProfileSaveFields(fields: ProfileSaveFields): boolean {
  return Boolean(fields.nickname || fields.avatar || fields.avatarColor);
}

/**
 * Whether Done may start a save. Blocks double-submit while saving.
 * Empty dirty set is treated as success path (close without write).
 */
export function canStartProfileSave(phase: ProfileSavePhase): boolean {
  return phase === 'draft' || phase === 'error';
}

/** Next phase after a save attempt settles. */
export function nextProfileSavePhase(
  outcome: 'start' | 'success' | 'error' | 'reset',
  current: ProfileSavePhase,
): ProfileSavePhase {
  if (outcome === 'reset') return 'draft';
  if (outcome === 'start') {
    return canStartProfileSave(current) ? 'saving' : current;
  }
  if (current !== 'saving') return current;
  return outcome === 'success' ? 'success' : 'error';
}

/** Close overlay only after success or when there was nothing to write. */
export function shouldCloseAfterProfileSave(
  phase: ProfileSavePhase,
  hadFields: boolean,
): boolean {
  if (!hadFields) return true;
  return phase === 'success';
}

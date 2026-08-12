import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProfileSaveFields,
  canStartProfileSave,
  hasProfileSaveFields,
  nextProfileSavePhase,
  shouldCloseAfterProfileSave,
} from '../utils/profileSaveLifecycle';

const overlay = readFileSync(
  join(__dirname, '../screens/MapScreen/components/ProfileOverlay.tsx'),
  'utf8',
);
const authFlow = readFileSync(join(__dirname, '../state/useAuthFlow.ts'), 'utf8');
const profileService = readFileSync(
  join(__dirname, '../api/services/ProfileService.ts'),
  'utf8',
);

describe('profile save lifecycle (#169)', () => {
  describe('buildProfileSaveFields', () => {
    it('diffs draft against committed SoT and ignores no-ops', () => {
      expect(
        buildProfileSaveFields(
          { name: 'Ada', avatar: '🦊', color: '#111' },
          { name: 'Ada', avatar: '🦊', avatarColor: '#111' },
        ),
      ).toEqual({});
      expect(
        buildProfileSaveFields(
          { name: '  Bob  ', avatar: '🐑', color: '#222' },
          { name: 'Ada', avatar: '🦊', avatarColor: '#111' },
        ),
      ).toEqual({ nickname: 'Bob', avatar: '🐑', avatarColor: '#222' });
    });

    it('does not treat empty nickname as a change', () => {
      expect(
        hasProfileSaveFields(
          buildProfileSaveFields(
            { name: '   ', avatar: undefined, color: undefined },
            { name: 'Ada' },
          ),
        ),
      ).toBe(false);
    });
  });

  describe('phase machine', () => {
    it('blocks double submit while saving', () => {
      expect(canStartProfileSave('draft')).toBe(true);
      expect(canStartProfileSave('error')).toBe(true);
      expect(canStartProfileSave('saving')).toBe(false);
      expect(canStartProfileSave('success')).toBe(false);
      expect(nextProfileSavePhase('start', 'saving')).toBe('saving');
    });

    it('moves draft → saving → success|error and resets', () => {
      expect(nextProfileSavePhase('start', 'draft')).toBe('saving');
      expect(nextProfileSavePhase('success', 'saving')).toBe('success');
      expect(nextProfileSavePhase('error', 'saving')).toBe('error');
      expect(nextProfileSavePhase('reset', 'error')).toBe('draft');
      // Stale settle while not saving is ignored
      expect(nextProfileSavePhase('success', 'draft')).toBe('draft');
    });

    it('closes only on success or empty write', () => {
      expect(shouldCloseAfterProfileSave('success', true)).toBe(true);
      expect(shouldCloseAfterProfileSave('error', true)).toBe(false);
      expect(shouldCloseAfterProfileSave('saving', true)).toBe(false);
      expect(shouldCloseAfterProfileSave('draft', false)).toBe(true);
    });
  });

  describe('overlay + service contracts', () => {
    it('awaits updateProfile before onClose and separates cancel vs Done', () => {
      expect(overlay).toContain('onDone={handleSave}');
      expect(overlay).toContain('onClose={handleCancel}');
      expect(overlay).toMatch(/await\s+updateProfile/);
      expect(overlay).toContain("phase === 'saving'");
      expect(overlay).toContain('canStartProfileSave');
      // Must not fire-and-forget close-first
      expect(overlay).not.toMatch(/onClose\(\);\s*\n\s*const nickname/);
    });

    it('commits session profile only after server write succeeds', () => {
      // Optimistic setUser before await would pollute committed avatar on failure races.
      const updateBody = authFlow.slice(
        authFlow.indexOf('const updateProfile = useCallback'),
        authFlow.indexOf('return {', authFlow.indexOf('const updateProfile = useCallback')),
      );
      expect(updateBody).toContain('await updateProfileApi(fields)');
      // setUser for avatar must come after the await, not before.
      const awaitIdx = updateBody.indexOf('await updateProfileApi(fields)');
      const setUserIdx = updateBody.indexOf('setUser(');
      expect(awaitIdx).toBeGreaterThan(-1);
      expect(setUserIdx).toBeGreaterThan(awaitIdx);
    });

    it('upserts missing profile row after empty update', () => {
      expect(profileService).toContain('.upsert(');
      expect(profileService).toContain("onConflict: 'id'");
      expect(profileService).toContain('if (!data)');
    });
  });
});

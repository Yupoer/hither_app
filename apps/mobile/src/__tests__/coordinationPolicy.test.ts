import {
  computeCoordinationOutcome,
  isUnanswered,
} from '../utils/coordinationPolicy';

const members = ['u1', 'u2', 'u3', 'u4'];

describe('computeCoordinationOutcome', () => {
  describe('timeout_default', () => {
    it('uses default at zero responses', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'timeout_default',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('ignores responses and still uses default', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'timeout_default',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'change' },
          ],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });
  });

  describe('organizer_override at deadline', () => {
    it('falls back to default when no override was applied', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'organizer_override',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [{ userId: 'u1', optionId: 'change' }],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });
  });

  describe('unanimity', () => {
    it('defaults at zero responses (silence is not consent)', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'unanimity',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('defaults on partial responses even when unanimous among responders', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'unanimity',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'change' },
          ],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('accepts when every eligible member responds with the same option', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'unanimity',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: members.map((userId) => ({ userId, optionId: 'change' })),
        }),
      ).toEqual({ optionId: 'change', source: 'unanimity' });
    });

    it('defaults on conflicting responses', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'unanimity',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'keep' },
            { userId: 'u3', optionId: 'change' },
            { userId: 'u4', optionId: 'change' },
          ],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });
  });

  describe('majority', () => {
    it('defaults at zero responses', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'majority',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('counts only responders — unanswered is neither side', () => {
      // 2 of 2 responders chose change (>50%); u3/u4 silent.
      expect(
        computeCoordinationOutcome({
          policy: 'majority',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'change' },
          ],
        }),
      ).toEqual({ optionId: 'change', source: 'majority' });
    });

    it('defaults on a tie among responders', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'majority',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'alt' },
          ],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('defaults when no option has a strict majority of responders', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'majority',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'a' },
            { userId: 'u2', optionId: 'b' },
            { userId: 'u3', optionId: 'c' },
          ],
        }),
      ).toEqual({ optionId: 'keep', source: 'timeout_default' });
    });

    it('accepts a clear majority of responders', () => {
      expect(
        computeCoordinationOutcome({
          policy: 'majority',
          defaultOutcome: 'keep',
          eligibleUserIds: members,
          responses: [
            { userId: 'u1', optionId: 'change' },
            { userId: 'u2', optionId: 'change' },
            { userId: 'u3', optionId: 'keep' },
          ],
        }),
      ).toEqual({ optionId: 'change', source: 'majority' });
    });
  });
});

describe('eligible filter', () => {
  it('ignores ineligible conflicting votes for majority', () => {
    // Eligible u1+u2 both chose change; outsider u99 chose keep — must not flip.
    expect(
      computeCoordinationOutcome({
        policy: 'majority',
        defaultOutcome: 'keep',
        eligibleUserIds: ['u1', 'u2'],
        responses: [
          { userId: 'u1', optionId: 'change' },
          { userId: 'u2', optionId: 'change' },
          { userId: 'u99', optionId: 'keep' },
        ],
      }),
    ).toEqual({ optionId: 'change', source: 'majority' });
  });

  it('ignores ineligible conflicting votes for unanimity', () => {
    expect(
      computeCoordinationOutcome({
        policy: 'unanimity',
        defaultOutcome: 'keep',
        eligibleUserIds: ['u1', 'u2'],
        responses: [
          { userId: 'u1', optionId: 'change' },
          { userId: 'u2', optionId: 'change' },
          { userId: 'u99', optionId: 'keep' },
        ],
      }),
    ).toEqual({ optionId: 'change', source: 'unanimity' });
  });
});

describe('isUnanswered', () => {
  it('treats missing response rows as unanswered, not rejection', () => {
    const responses = [{ userId: 'u1', optionId: 'change' }];
    expect(isUnanswered(responses, 'u1')).toBe(false);
    expect(isUnanswered(responses, 'u2')).toBe(true);
  });
});

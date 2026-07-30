import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('foreground arrival feedback', () => {
  it('uses accuracy-aware reduceArrival as sole auto-arrive authority (no bare OR)', () => {
    expect(source).toContain('const arrivedNow = next.status === \'arrived\'');
    expect(source).not.toMatch(/arrivedNow\s*=\s*insideRadius\s*\|\|/);
    expect(source).toContain('reduceArrival(');
    // Low-accuracy samples must go through the reducer, not hasArrived alone.
    const autoBlock = source.slice(
      source.indexOf('// Auto-arrive while navigating'),
      source.indexOf('// Auto-arrive while navigating') + 1200,
    );
    expect(autoBlock).toContain('accuracyM: deviceAccuracyM');
    expect(autoBlock).not.toContain('insideRadius ||');
  });

  it('starts visual arrival feedback before waiting for the database ACK', () => {
    const effect = source.slice(
      source.indexOf('if (arrivedNow && user?.id)'),
      source.indexOf('  }, [', source.indexOf('if (arrivedNow && user?.id)')),
    );
    expect(effect.indexOf('afterPersonalArrivalRef.current(navTarget')).toBeGreaterThanOrEqual(0);
    expect(effect.indexOf('afterPersonalArrivalRef.current(navTarget')).toBeLessThan(
      effect.indexOf('setDestinationArrival(navTarget.id'),
    );
    // Celebrate first without complete; complete only after arrival write succeeds.
    expect(effect).toContain('promptComplete: false');
    expect(effect).toContain('promptComplete: true');
    const writeIdx = effect.indexOf('setDestinationArrival(navTarget.id');
    const completeIdx = effect.indexOf('promptComplete: true');
    expect(completeIdx).toBeGreaterThan(writeIdx);
    expect(source).toMatch(
      /const personallyArrived = myCompletedDestinationIds\.has\(dest\.id\) \|\| \(\s*autoArrivedDestId === dest\.id/,
    );
    expect(source).toContain('arrivalDimOverlay');
    expect(source).toContain('arrivalCenterCheckLayer');
    expect(source).toContain('1_600');
    expect(source).toContain('COMPLETE_PROMPT_DELAY_MS');
    expect(source).toContain("kind: 'destinationArrival'");
    expect(source).toContain('arrivalNotificationDestIdsRef.current');
    expect(source).not.toContain('arrivalCheckBadge');
  });

  it('dims only during celebrate and covers the full glass card shell', () => {
    // Permanent dim was the iOS field bug: personallyArrived || celebrate.
    expect(source).not.toMatch(
      /personallyArrived\s*\|\|\s*arrivalCelebrateDestId\s*===\s*dest\.id/,
    );
    expect(source).toContain('arrivalCelebrateDestId === dest.id');
    // Dim + check are GlassView-level (outside padded pressable).
    const cardBlock = source.slice(
      source.indexOf('liquidGlass.GlassView'),
      source.indexOf('liquidGlass.GlassView') + 2500,
    );
    // First GlassView may be elsewhere — use carousel card marker.
    const carouselCard = source.slice(
      source.indexOf('key={`carousel-dest-${dest.id}-${index}`}'),
      source.indexOf('key={`carousel-dest-${dest.id}-${index}`}') + 4000,
    );
    const dimIdx = carouselCard.indexOf('styles.arrivalDimOverlay');
    const pressableIdx = carouselCard.indexOf('<GatheringCardPressable');
    expect(dimIdx).toBeGreaterThanOrEqual(0);
    expect(pressableIdx).toBeGreaterThan(dimIdx);
    expect(carouselCard).toContain('styles.cardInner');
    // Full-surface fill (not padded content box only).
    expect(source).toMatch(/arrivalDimOverlay:\s*\{[\s\S]*?absoluteFill/);
    expect(source).toMatch(/arrivalCenterCheckLayer:\s*\{[\s\S]*?absoluteFill/);
    // Padding is on cardInner so dim can cover the whole shell.
    expect(source).toMatch(/cardInner:\s*\{[\s\S]*?paddingHorizontal:\s*cardPad/);
    const cardStyleBlock = source.slice(
      source.indexOf('// Gathering-point card shell'),
      source.indexOf('cardActiveBorder:'),
    );
    expect(cardStyleBlock).toContain('card: {');
    expect(cardStyleBlock).toContain('cardInner: {');
    expect(cardStyleBlock).toContain('paddingHorizontal: cardPad');
    // Shell itself has no padding (only cardInner).
    const shellOnly = cardStyleBlock.slice(
      cardStyleBlock.indexOf('card: {'),
      cardStyleBlock.indexOf('cardInner: {'),
    );
    expect(shellOnly).not.toContain('paddingHorizontal');
    expect(shellOnly).not.toContain('paddingTop');
  });

  it('rolls back only failed arrival writes, not failed post-write refreshes', () => {
    const submit = source.slice(
      source.indexOf('const submitArrivalWithTimestamp'),
      source.indexOf('/** Self Arrive', source.indexOf('const submitArrivalWithTimestamp')),
    );
    expect(submit).toContain('await setDestinationArrivalAt');
    expect(submit).toContain('await loadGatheringWorkflow().catch(() => undefined)');
    expect(submit.indexOf('await setDestinationArrivalAt')).toBeLessThan(
      submit.indexOf('await loadGatheringWorkflow().catch(() => undefined)'),
    );

    const undo = source.slice(
      source.indexOf('const handleArrival = useCallback'),
      source.indexOf('const submitArrivalWithTimestamp'),
    );
    expect(undo.indexOf('await setDestinationArrival(')).toBeLessThan(
      undo.indexOf('arrivalNotificationDestIdsRef.current.delete'),
    );
  });
});

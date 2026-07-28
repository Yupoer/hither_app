import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('foreground arrival feedback', () => {
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
});

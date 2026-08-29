import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('tour card natural layout contract', () => {
  it('renders complete copy before the CTA without an inner scroll view', () => {
    const overlay = read('featureTour/GroupFeatureTourOverlay.tsx');
    const card = read('featureTour/TourCard.tsx');
    const cardIos = read('featureTour/TourCard.ios.tsx');

    expect(overlay).toContain('estimatedCardHeight: ESTIMATED_CARD_HEIGHT');
    expect(overlay).toContain('onLayout={onCardLayout}');
    expect(overlay).not.toContain('height: boundedCardHeight');
    expect(overlay).not.toContain('maxHeight: placement.maxCardHeight');
    expect(card).not.toContain('<ScrollView');
    expect(card).not.toContain('numberOfLines');
    expect(cardIos).not.toContain('ScrollView');
    expect(cardIos).not.toContain('maxHeight: Math.max');
    expect(card).toContain('minHeight: 104');
    expect(cardIos).toContain('frame({ minHeight: 104 })');
    expect(card).toContain('paddingHorizontal: 28');
    expect(cardIos).toContain('padding({ horizontal: 28, vertical: 20 })');
    expect(card).toContain('backgroundColor: glass.tourCard');
    expect(cardIos).toContain("tint: '#4B5362'");
  });
});

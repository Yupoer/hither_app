import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('tour card bounded layout contract', () => {
  it('pins CTA outside a bounded, scrollable card shell', () => {
    const overlay = read('featureTour/GroupFeatureTourOverlay.tsx');
    const card = read('featureTour/TourCard.tsx');
    const cardIos = read('featureTour/TourCard.ios.tsx');

    expect(overlay).toContain('height: boundedCardHeight');
    expect(overlay).toContain('maxHeight: placement.maxCardHeight');
    expect(card).toContain('<ScrollView');
    expect(card).toContain('maxHeight: Math.max(48, maxCardHeight');
    expect(cardIos).toContain('matchContents={false}');
    expect(cardIos).toContain('height: \'100%\'');
    expect(cardIos).toContain('maxHeight: Math.max(48, maxCardHeight');
  });
});

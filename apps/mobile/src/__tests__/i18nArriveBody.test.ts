import { translations } from '../i18n';

describe('map.arriveBody i18n', () => {
  it('has zh and en copy with title placeholder', () => {
    expect(translations.zh['map.arriveBody']).toContain('{title}');
    expect(translations.en['map.arriveBody']).toContain('{title}');
    expect(translations.zh['map.arriveBody']).not.toBe('map.arriveBody');
    expect(translations.zh['map.arriveTitle']).toBe('已抵達');
  });
});

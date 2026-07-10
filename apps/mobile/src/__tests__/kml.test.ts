import { parseKml } from '../utils/kml';

const MY_MAPS_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Folder>
    <name>My Trip</name>
    <Placemark>
      <name><![CDATA[Taipei 101]]></name>
      <Point>
        <coordinates>121.5645,25.0339,0</coordinates>
      </Point>
    </Placemark>
  </Folder>
</Document>
</kml>`;

describe('parseKml', () => {
  it('parses a standard My Maps Point placemark with CDATA name', () => {
    const result = parseKml(MY_MAPS_KML);
    expect(result).toEqual([{ name: 'Taipei 101', latitude: 25.0339, longitude: 121.5645 }]);
  });

  it('falls back to Unnamed N when there is no <name>', () => {
    const xml = `<Placemark><Point><coordinates>121.5,25.0</coordinates></Point></Placemark>`;
    const result = parseKml(xml);
    expect(result).toEqual([{ name: 'Unnamed 1', latitude: 25.0, longitude: 121.5 }]);
  });

  it('trims whitespace and newlines inside coordinates', () => {
    const xml = `<Placemark><name>Spot</name><Point><coordinates>
      121.5,25.0,0
    </coordinates></Point></Placemark>`;
    const result = parseKml(xml);
    expect(result).toEqual([{ name: 'Spot', latitude: 25.0, longitude: 121.5 }]);
  });

  it('skips placemarks with out-of-range or NaN coordinates', () => {
    const xml = `
      <Placemark><name>Bad Lon</name><Point><coordinates>200,25</coordinates></Point></Placemark>
      <Placemark><name>Bad Lat</name><Point><coordinates>121,95</coordinates></Point></Placemark>
      <Placemark><name>Not A Number</name><Point><coordinates>abc,def</coordinates></Point></Placemark>
      <Placemark><name>Good</name><Point><coordinates>121,25</coordinates></Point></Placemark>
    `;
    const result = parseKml(xml);
    expect(result).toEqual([{ name: 'Good', latitude: 25, longitude: 121 }]);
  });

  it('returns an empty array for non-KML text', () => {
    expect(parseKml('not xml at all, just plain text')).toEqual([]);
    expect(parseKml('')).toEqual([]);
  });

  it('takes the first coordinate of a LineString', () => {
    const xml = `<Placemark><name>Route</name><LineString><coordinates>
      121.1,25.1,0 121.2,25.2,0 121.3,25.3,0
    </coordinates></LineString></Placemark>`;
    const result = parseKml(xml);
    expect(result).toEqual([{ name: 'Route', latitude: 25.1, longitude: 121.1 }]);
  });
});

import {
  displayRoutePoints,
  maxScreenSpaceErrorMeters,
  routeMetersPerPixel,
  routeToleranceMeters,
  simplifyRoutePointsForDisplay,
} from '../utils/routeLod';

describe('route display LOD', () => {
  const detailedRoute = [
    { latitude: 25, longitude: 121 },
    { latitude: 25.0001, longitude: 121.0004 },
    { latitude: 25.0002, longitude: 121.00075 },
    { latitude: 25.0003, longitude: 121.0012 },
  ];

  it('keeps provider geometry at near zoom', () => {
    expect(displayRoutePoints(detailedRoute, {
      latitude: 25,
      longitudeDelta: 0.000001,
      widthPx: 390,
    })).toEqual(detailedRoute);
  });

  it('simplifies only the display projection and never mutates the provider array', () => {
    const source = [
      { latitude: 25, longitude: 121 },
      { latitude: 25.001, longitude: 121.0005 },
      { latitude: 25.002, longitude: 121 },
    ];
    const before = source.map((point) => ({ ...point }));
    const projected = simplifyRoutePointsForDisplay(source, 200);
    expect(source).toEqual(before);
    expect(projected).toEqual([source[0], source[2]]);
  });

  it('derives tolerance from meters-per-pixel with monotonic continuous zoom', () => {
    const close = routeToleranceMeters({ latitude: 25, longitudeDelta: 0.01, widthPx: 390 });
    const justFarther = routeToleranceMeters({ latitude: 25, longitudeDelta: 0.0101, widthPx: 390 });
    const far = routeToleranceMeters({ latitude: 25, longitudeDelta: 1, widthPx: 390 });
    expect(close).toBeLessThan(justFarther);
    expect(justFarther).toBeLessThan(far);
    expect(justFarther - close).toBeLessThan(1);
    expect(routeMetersPerPixel({ latitude: 25, longitudeDelta: 1, widthPx: 390 })).toBeGreaterThan(200);
  });

  it('keeps screen-space error within the target pixel budget', () => {
    const route = [
      { latitude: 25.0000, longitude: 121.0000 },
      { latitude: 25.0005, longitude: 121.0003 },
      { latitude: 25.0010, longitude: 121.0000 },
      { latitude: 25.0015, longitude: 121.0004 },
      { latitude: 25.0020, longitude: 121.0000 },
    ];
    const viewport = { latitude: 25, longitudeDelta: 0.2, widthPx: 390 };
    const displayed = displayRoutePoints(route, viewport);
    const errorPixels = maxScreenSpaceErrorMeters(route, displayed)
      / routeMetersPerPixel(viewport);
    expect(errorPixels).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('preserves a roundabout/U-turn fixture at close zoom and never mutates raw data', () => {
    const uTurn = [
      { latitude: 25.0000, longitude: 121.0000 },
      { latitude: 25.0004, longitude: 121.0000 },
      { latitude: 25.0008, longitude: 121.0004 },
      { latitude: 25.0004, longitude: 121.0008 },
      { latitude: 25.0000, longitude: 121.0008 },
      { latitude: 25.0004, longitude: 121.0004 },
      { latitude: 25.0010, longitude: 121.0004 },
    ];
    const before = uTurn.map((point) => ({ ...point }));
    const displayed = displayRoutePoints(uTurn, {
      latitude: 25,
      longitudeDelta: 0.000001,
      widthPx: 390,
    });
    expect(displayed).toEqual(uTurn);
    expect(uTurn).toEqual(before);
  });

  it('reduces point count when zoomed out and restores all provider points when zoomed in', () => {
    const route = Array.from({ length: 80 }, (_, index) => ({
      latitude: 25 + index * 0.00035,
      longitude: 121 + Math.sin(index / 3) * 0.002,
    }));
    const far = displayRoutePoints(route, {
      latitude: 25,
      longitudeDelta: 1,
      widthPx: 390,
    });
    const near = displayRoutePoints(route, {
      latitude: 25,
      longitudeDelta: 0.000001,
      widthPx: 390,
    });
    expect(far.length).toBeLessThan(route.length);
    expect(near).toEqual(route);
  });

  it('does not alter raw route distance or ETA data', () => {
    const raw = {
      distanceMeters: 1234,
      expectedTravelTimeSeconds: 900,
      points: detailedRoute,
    };
    const displayed = displayRoutePoints(raw.points, {
      latitude: 25,
      longitudeDelta: 0.5,
      widthPx: 390,
    });
    expect(raw.distanceMeters).toBe(1234);
    expect(raw.expectedTravelTimeSeconds).toBe(900);
    expect(raw.points).toEqual(detailedRoute);
    expect(displayed[0]).toEqual(raw.points[0]);
    expect(displayed.at(-1)).toEqual(raw.points.at(-1));
  });
});

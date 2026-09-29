export interface StarParticle { x: number; y: number; radius: number; velocity: number; phase: number; }
export const STARFIELD_BASELINE = { speed: 0.6, density: 0.055, radius: 4.5, twinkleFrequency: 2.6 / 9 } as const;
export function starfieldFactors(collapsed: boolean) {
  return { density: collapsed ? 1 / 3 : 1, speed: collapsed ? 2 : 1, size: collapsed ? 2 : 1 };
}
/** Seed once per layout, not once per pixel per animation frame. */
export function createStarfieldParticles(width: number, height: number, collapsed: boolean): StarParticle[] {
  if (width <= 0 || height <= 0) return [];
  const factors = starfieldFactors(collapsed);
  let seed = 1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const particles: StarParticle[] = [];
  for (let layer = 0; layer < 3; layer++) {
    const scale = (50 + layer * 80) * 0.2;
    const count = Math.round((width / height * scale + 2) * (scale + 2) * STARFIELD_BASELINE.density);
    // Use a stable subset so density changes don't reshuffle every star.
    for (let index = 0; index < count; index++) {
      const x = random() * width;
      const y = random() * height;
      const radius = (0.004 + random() * 0.024) * (0.70 + 0.13 * 3) * STARFIELD_BASELINE.radius * height / scale;
      const velocity = STARFIELD_BASELINE.speed * (0.18 + layer * 0.08) * (5 + random() * 5) * height / scale;
      const phase = random() * Math.PI * 2;
      if (!collapsed || index % 3 === 0) particles.push({ x, y, radius: radius * factors.size, velocity: velocity * factors.speed, phase });
    }
  }
  return particles;
}

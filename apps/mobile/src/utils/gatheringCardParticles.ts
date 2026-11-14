export const GATHERING_PARTICLE_MAX_FPS = 60;
export const GATHERING_PARTICLE_RISE_MS = 760;
export const GATHERING_PARTICLE_SETTLE_MS = 560;
export const GATHERING_PARTICLE_SHADES = [0.13, 0.25, 0.38, 0.52, 0.67] as const;

const BIRTH_INTERVAL_MS = 230;
const MAX_LIFETIME_MS = 4100;

export function gatheringParticlesAt(time: number, width: number, height: number) {
  'worklet';
  if (time < 0 || width <= 0 || height < 8) return [];
  const particles: { x: number; y: number; radius: number; shade: number }[] = [];
  const first = Math.max(0, Math.ceil((time - MAX_LIFETIME_MS) / BIRTH_INTERVAL_MS));
  const last = Math.floor(time / BIRTH_INTERVAL_MS);
  for (let index = first; index <= last; index++) {
    let seed = Math.imul(index + 1, 747796405) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
    seed = (seed ^ (seed >>> 13)) >>> 0;
    const lane = (seed & 255) / 255;
    const variation = ((seed >>> 8) & 255) / 255;
    const lifetime = 2750 + variation * (MAX_LIFETIME_MS - 2750);
    const age = time - index * BIRTH_INTERVAL_MS;
    if (age >= lifetime) continue;
    const progress = age / lifetime;
    const radius = 0.7 + ((seed >>> 16) & 255) / 255 * 1.35;
    const show = Math.min(1, age / 250, (lifetime - age) / 450);
    const shimmer = 0.75 + 0.25 * Math.cos(age / 230 + variation * 8);
    const shade = Math.min(GATHERING_PARTICLE_SHADES.length - 1,
      Math.round(show * shimmer * (GATHERING_PARTICLE_SHADES.length - 1)));
    if (show <= 0) continue;
    const inset = radius * 1.65;
    const y = inset + (height - 2 * inset) * lane + Math.sin(age / 450 + variation * 5) * 1.5;
    particles.push({
      x: width + radius - (width + 2 * radius) * progress,
      y: Math.max(inset, Math.min(height - inset, y)),
      radius,
      shade,
    });
  }
  return particles;
}

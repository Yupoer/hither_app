import type { GroupState } from '../types';
// Only the already-authenticated, currently displayed state may seed a cold
// local transaction. This is not an authoritative remote recovery snapshot.
const visible = new Map<string, { actorId: string; state: GroupState }>();
export function retainVisibleGroupSeed(actorId: string, state: GroupState): () => void {
  const seed = { actorId, state };
  visible.set(state.group.id, seed);
  return () => { if (visible.get(state.group.id) === seed) visible.delete(state.group.id); };
}
export function getVisibleGroupSeed(actorId: string, groupId: string): GroupState | null {
  const seed = visible.get(groupId);
  return seed?.actorId === actorId ? seed.state : null;
}

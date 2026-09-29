export interface AppNotice {
  id: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

let current: AppNotice | null = null;
const pending: AppNotice[] = [];
const seen = new Set<string>();
const listeners = new Set<(notice: AppNotice | null) => void>();
const emit = () => listeners.forEach(listener => listener(current));

/** One bounded foreground surface; retries of the same event never spam it. */
export function showAppNotice(notice: AppNotice): void {
  if (seen.has(notice.id)) return;
  seen.add(notice.id);
  if (seen.size > 500) seen.delete(seen.values().next().value!);
  if (current) {
    pending.push(notice);
    if (pending.length > 20) pending.shift();
  } else { current = notice; emit(); }
}
export function dismissAppNotice(id: string): void {
  if (current?.id !== id) return;
  current = pending.shift() ?? null;
  emit();
}
export function clearAppNotices(): void {
  current = null;
  pending.length = 0;
  seen.clear();
  emit();
}
export function subscribeAppNotices(listener: (notice: AppNotice | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
let failureSequence = 0;
export function showOperationFailure(title: string, message: string): void {
  showAppNotice({ id: `failure:${++failureSequence}`, title, message });
}

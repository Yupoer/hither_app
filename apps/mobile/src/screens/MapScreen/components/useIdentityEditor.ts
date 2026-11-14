import { useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';

type Identity = { name: string; avatar: string; color: string };
export type IdentityPatch = Partial<Identity>;

const saveTails = new Map<string, Promise<void>>();

function saveInOrder(scope: string, save: () => Promise<void>) {
  const previous = saveTails.get(scope);
  const next = previous ? previous.catch(() => undefined).then(save) : save();
  saveTails.set(scope, next);
  return next.finally(() => {
    if (saveTails.get(scope) === next) saveTails.delete(scope);
  });
}

export function createIdentityWriter({
  scope,
  save,
  onError,
}: {
  scope: string;
  save: (changes: IdentityPatch) => Promise<void>;
  onError: () => void;
}) {
  let pending: IdentityPatch = {};
  let writing = false;
  let closed = false;
  let nameCleared = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (closed || writing || Object.keys(pending).length === 0) return;
    const changes = pending;
    pending = {};
    writing = true;
    let success = false;
    try {
      await saveInOrder(scope, () => save(changes));
      success = true;
    } catch {
      if (!closed) {
        pending = { ...changes, ...pending };
        if (nameCleared) delete pending.name;
        onError();
      }
    } finally {
      writing = false;
      if (!closed && success && timer === undefined) void flush();
    }
  };

  return {
    enqueue(changes: IdentityPatch, delay = 0) {
      if (closed) return;
      if (changes.name !== undefined) nameCleared = false;
      pending = { ...pending, ...changes };
      if (timer) clearTimeout(timer);
      if (delay > 0) timer = setTimeout(() => { void flush(); }, delay);
      else void flush();
    },
    clearName() {
      nameCleared = true;
      delete pending.name;
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (Object.keys(pending).length === 0) return;
      const finalChanges = pending;
      pending = {};
      // Reserve the last write before a reopened editor can enqueue its own.
      void saveInOrder(scope, () => save(finalChanges)).catch(onError);
    },
    flush,
  };
}

export function useIdentityEditor(scope: string, initial: Identity, save: (changes: IdentityPatch) => Promise<void>) {
  const [edits, setEdits] = useState<IdentityPatch>({});
  const [failed, setFailed] = useState(false);
  const writer = useRef<ReturnType<typeof createIdentityWriter> | null>(null);
  const draft = { ...initial, ...edits };

  useMountEffect(() => {
    let active = true;
    const queue = createIdentityWriter({
      scope,
      save: async changes => {
        await save(changes);
        if (active) setFailed(false);
      },
      onError: () => {
        if (active) setFailed(true);
      },
    });
    writer.current = queue;
    return () => {
      active = false;
      writer.current = null;
      queue.close();
    };
  });

  return {
    draft,
    failed,
    retry: async () => writer.current?.flush(),
    change(changes: IdentityPatch) {
      setEdits(previous => ({ ...previous, ...changes }));
      if (changes.name !== undefined && !changes.name.trim()) {
        writer.current?.clearName();
        return;
      }
      writer.current?.enqueue(changes, changes.name !== undefined ? 350 : 0);
    },
    finishName() {
      setEdits(previous => ({ ...previous, name: previous.name?.trim() || initial.name }));
      void writer.current?.flush();
    },
  };
}

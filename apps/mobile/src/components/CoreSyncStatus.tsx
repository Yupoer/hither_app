import { useEffect } from 'react';
import { showAppNotice, showOperationFailure } from '../state/appNotice';
import type { CoreOperation } from '../types/coreData';
import type { TranslationKey } from '../i18n';

interface Props {
  operations: CoreOperation[];
  actorId: string | null;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  /**
   * Kept for source compatibility with older callers.  Conflict handling is
   * now automatic in the durable queue, so the status surface deliberately
   * does not expose discard/reapply choices.
   */
  onResolve: (operation: CoreOperation, action: 'discard' | 'reapply') => Promise<void>;
  describeError: (error: unknown) => string;
}

/** Pending is silent. Only a failed transition posts a transient native notice. */
export default function CoreSyncStatus({ operations, actorId, t, describeError }: Props) {
  useEffect(() => {
    for (const op of operations) {
      if (!actorId || (op.actorId ?? op.payload.actorId) !== actorId) continue;
      if (op.status !== 'failed' && op.status !== 'conflict') continue;
      const rejected = op.status === 'conflict';
      showAppNotice({
        id: `sync:${actorId}:${op.id}:${rejected ? 'rejected' : 'delayed'}`,
        title: t(rejected ? 'notice.rejected' : 'notice.syncDelayed'),
        message: rejected ? describeError(op.conflictResult) : t('notice.retryInBackground'),
        ...(!rejected ? {
          actionLabel: t('interaction.retry'),
          onAction: async () => {
            try {
              const { flushCoreOperationOutbox, getCoreOperationOutbox } = await import('../state/coreDataSync');
              await getCoreOperationOutbox().retryFailedOperation(op.id);
              await flushCoreOperationOutbox();
            } catch (error) {
              showOperationFailure(t('map.setFailedTitle'), describeError(error));
            }
          },
        } : {}),
      });
    }
  }, [operations, actorId, t, describeError]);
  return null;
}

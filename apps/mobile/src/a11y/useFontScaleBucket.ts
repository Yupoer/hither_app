import { useCallback, useEffect, useState } from 'react';
import { AppState, PixelRatio, type AppStateStatus } from 'react-native';
import { fontScaleBucket, type FontScaleBucket } from '../theme/typeScale';

function readBucket(): FontScaleBucket {
  return fontScaleBucket(PixelRatio.getFontScale());
}

/**
 * Layout bucket for Dynamic Type: regular / large / xl.
 * Re-reads on AppState resume (user may change Settings → Text Size).
 */
export function useFontScaleBucket(): FontScaleBucket {
  const [bucket, setBucket] = useState<FontScaleBucket>(readBucket);

  const refresh = useCallback(() => {
    setBucket(readBucket());
  }, []);

  useEffect(() => {
    refresh();
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') refresh();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  return bucket;
}

export { fontScaleBucket };
export type { FontScaleBucket };

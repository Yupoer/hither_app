import { useState } from 'react';

export function useMapScopeControls(scopeId: string | undefined) {
  const [previousScopeId, setPreviousScopeId] = useState(scopeId);
  const [viewingScope, setViewingScope] = useState<'main' | 'sub'>('main');
  const [editButtonActive, setEditButtonActive] = useState(false);
  const [kmlScopeId, setKmlScopeId] = useState(scopeId);
  if (!Object.is(previousScopeId, scopeId)) {
    setPreviousScopeId(scopeId);
    setEditButtonActive(false);
    setKmlScopeId(scopeId);
  }
  if (!scopeId && viewingScope === 'sub') setViewingScope('main');
  return { viewingScope, setViewingScope, editButtonActive, setEditButtonActive, kmlScopeId, setKmlScopeId };
}

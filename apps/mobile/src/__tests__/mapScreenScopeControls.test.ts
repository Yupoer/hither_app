import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useMapScopeControls } from '../screens/MapScreen/hooks/useMapScopeControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapScreen scoped controls', () => {
  let tree: ReactTestRenderer | undefined;
  let controls: ReturnType<typeof useMapScopeControls>;
  let draft = '';
  let editDraft: React.Dispatch<React.SetStateAction<string>> = () => undefined;
  function Owner({ scope }: { scope: string | undefined }) {
    controls = useMapScopeControls(scope);
    const [value, setValue] = useState('original');
    draft = value;
    editDraft = setValue;
    return null;
  }
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it('resets only edit and import scope on subgroup changes while preserving owner drafts', () => {
    act(() => { tree = create(React.createElement(Owner, { scope: 'a' })); });
    act(() => { controls.setEditButtonActive(true); controls.setKmlScopeId('custom'); editDraft('unsaved'); });
    act(() => tree?.update(React.createElement(Owner, { scope: 'a' })));
    expect(controls.editButtonActive).toBe(true);
    expect(controls.kmlScopeId).toBe('custom');
    act(() => tree?.update(React.createElement(Owner, { scope: 'b' })));
    expect(controls.editButtonActive).toBe(false);
    expect(controls.kmlScopeId).toBe('b');
    expect(draft).toBe('unsaved');
    act(() => tree?.update(React.createElement(Owner, { scope: 'a' })));
    expect(controls.kmlScopeId).toBe('a');
    expect(draft).toBe('unsaved');
  });

  it('keeps a valid subgroup view and corrects an unavailable subgroup without external writes', () => {
    act(() => { tree = create(React.createElement(Owner, { scope: 'sub' })); });
    act(() => { controls.setViewingScope('sub'); });
    expect(controls.viewingScope).toBe('sub');
    act(() => tree?.update(React.createElement(Owner, { scope: undefined })));
    expect(controls.viewingScope).toBe('main');
    expect(controls.kmlScopeId).toBeUndefined();
    act(() => { controls.setViewingScope('sub'); });
    expect(controls.viewingScope).toBe('main');
  });
});

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SheetPresentation from '../components/SheetPresentation';
import { D6CommandsSheet } from '../screens/MapScreen/components/D6CommandsSheet';
import { QuickCommandGrid } from '../screens/MapScreen/components/QuickCommandGrid';

jest.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (styles: object) => styles },
}));
jest.mock('../components/SheetPresentation', () => ({
  __esModule: true,
  default: 'SheetPresentation',
}));
jest.mock('../screens/MapScreen/components/QuickCommandGrid', () => ({ QuickCommandGrid: 'QuickCommandGrid' }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

describe('D6 command sheet presentation', () => {
  let renderer: ReactTestRenderer | undefined;
  const onClose = jest.fn();
  const onDismiss = jest.fn();
  const onCommandSent = jest.fn();

  function render(open: boolean) {
    const element = React.createElement(D6CommandsSheet, {
      groupId: 'team-1', isLeader: true, open, onClose, onDismiss, onCommandSent,
    });
    act(() => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
    return renderer;
  }

  beforeEach(() => { jest.clearAllMocks(); });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('keeps the command session through the close request and reports completion separately', () => {
    const tree = render(true);
    if (!tree) throw new Error('Command sheet is not mounted');
    const presentation = tree.root.findByType(SheetPresentation);
    expect(presentation.props.visible).toBe(true);
    const grid = tree.root.findByType(QuickCommandGrid);
    expect(grid.props.groupId).toBe('team-1');

    act(() => grid.props.onClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    render(false);
    expect(presentation.props.visible).toBe(false);
    expect(grid.props.groupId).toBe('team-1');
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => presentation.props.onDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Animated, Modal } from 'react-native';
import { D6CommandsSheet } from '../screens/MapScreen/components/D6CommandsSheet';

type TimingCompletion = (result: { finished: boolean }) => void;
const mockStart = jest.fn((_complete: TimingCompletion) => undefined);
const mockTiming = jest.fn((_config: { toValue: number }) => undefined);

jest.mock('react-native', () => {
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
    interpolate(config: { outputRange: number[] }) {
      return { __getValue: () => config.outputRange[0] * (1 - this.value) + config.outputRange.at(-1)! * this.value };
    }
  }
  return {
    View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Pressable: 'Pressable',
    StyleSheet: { create: (styles: object) => styles },
    useWindowDimensions: () => ({ height: 800 }),
    Easing: { out: () => jest.fn(), cubic: jest.fn() },
    Animated: {
      View: 'AnimatedCard', Value,
      timing: (value: Value, config: { toValue: number }) => {
        mockTiming(config);
        return {
          start: (complete: TimingCompletion) => { value.setValue(config.toValue); mockStart(complete); },
          stop: () => undefined,
        };
      },
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 50, bottom: 30 }) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (id: string) => id }) }));
jest.mock('../screens/MapScreen/components/D6HomeChrome', () => ({ D6Surface: 'D6Surface' }));
jest.mock('../screens/MapScreen/components/QuickCommandGrid', () => ({ QuickCommandGrid: 'QuickCommandGrid' }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

describe('D6 command sheet presentation', () => {
  let renderer: ReactTestRenderer | undefined;
  const onClose = jest.fn();
  const onDismiss = jest.fn();
  const progress = new Animated.Value(0);

  function render(open: boolean, reduceMotion = false) {
    const element = React.createElement(D6CommandsSheet, {
      groupId: 'team-1', isLeader: true, open, reduceMotion, progress, onClose, onDismiss, onCommandSent: jest.fn(),
    });
    act(() => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  }

  function modal() {
    if (!renderer) throw new Error('Command modal is not mounted');
    return renderer.root.findByType(Modal);
  }

  function card() {
    if (!renderer) throw new Error('Command card is not mounted');
    return renderer.root.findByProps({ accessibilityViewIsModal: true });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    progress.setValue(0);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('starts only once its card can be seen and retains the modal through the shared exit', () => {
    render(true);
    expect(modal().props.animationType).toBe('none');
    act(() => modal().props.onShow());
    expect(mockTiming).not.toHaveBeenCalled();
    act(() => card().find(node => typeof node.props.onLayout === 'function').props.onLayout({ nativeEvent: { layout: { height: 280 } } }));
    progress.setValue(0.5);
    expect(card().props.style.at(-1).top.__getValue()).toBe(152);

    act(() => modal().props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    render(false);
    expect(card().props.pointerEvents).toBe('none');
    expect(modal().props.visible).toBe(true);

    const [complete] = mockStart.mock.calls[1];
    act(() => complete({ finished: true }));
    expect(modal().props.visible).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => modal().props.onDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('handles a close before presentation even when the card never laid out', () => {
    render(true, true);
    render(false, true);
    expect(mockTiming).not.toHaveBeenCalled();
    expect(modal().props.visible).toBe(true);
    act(() => modal().props.onShow());

    const [options] = mockTiming.mock.calls[0];
    const [complete] = mockStart.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ toValue: 0, duration: 0 }));
    act(() => complete({ finished: true }));
    expect(modal().props.visible).toBe(false);
  });
});

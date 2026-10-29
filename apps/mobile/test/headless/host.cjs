const assert = require('node:assert/strict');

exports.install = ({ jest, spec, strict, fatal, appState, alertQueue }) => {
  const React = require('react');
  const receipts = [];
  const linkingListeners = new Set();
  const tasks = new Map();
  const animations = new Map();
  let animationId = 0;
  const make = name => React.forwardRef(function NativeHost(props, ref) {
    React.useImperativeHandle(ref, () => ({
      focus: () => receipts.push({ host: name, method: 'focus' }),
      blur: () => receipts.push({ host: name, method: 'blur' }),
      scrollTo: value => receipts.push({ host: name, method: 'scrollTo', value }),
      scrollToOffset: value => receipts.push({ host: name, method: 'scrollToOffset', value }),
      scrollToIndex: value => receipts.push({ host: name, method: 'scrollToIndex', value }),
      measure: callback => callback(0, 0, 390, 844, 0, 0),
      measureInWindow: callback => callback(0, 0, 390, 844),
      animateToRegion: (...args) => receipts.push({ host: name, method: 'animateToRegion', args }),
      animateCamera: (...args) => receipts.push({ host: name, method: 'animateCamera', args }),
      ...(name === 'Marker' ? { animateMarkerToCoordinate: (...args) => receipts.push({ host: name, method: 'animateMarkerToCoordinate', args }) } : {}),
      setCamera: value => receipts.push({ host: name, method: 'setCamera', value }),
      fitToCoordinates: (...args) => receipts.push({ host: name, method: 'fitToCoordinates', args }),
      getCamera: async () => ({ center: { latitude: 25, longitude: 121 }, pitch: 0, heading: 0, altitude: 1000, zoom: 14 }),
      setNativeProps: value => receipts.push({ host: name, method: 'setNativeProps', value }),
    }), []);
    if ((name === 'Modal' && props.visible === false) || (name === 'SwiftUI.BottomSheet' && props.isPresented === false)) return null;
    const children = typeof props.children === 'function' ? props.children({ pressed: false }) : props.children;
    return React.createElement(`host:${name}`, props, children);
  });
  const hosts = Object.fromEntries(['View','Text','TextInput','Pressable','ScrollView','KeyboardAvoidingView','TouchableWithoutFeedback',
    'TouchableOpacity','ActivityIndicator','Modal','Image','Switch','RefreshControl','InputAccessoryView','Button'].map(name => [name, make(name)]));
  const dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation(callback) { for (const [id, animation] of [...animations]) if (animation.value === this) { animations.delete(id); animation.callback?.({ finished: false }); } callback?.(this.value); }
    interpolate() { return this; }
    addListener() { return 'listener'; }
    removeListener() {}
    removeAllListeners() {}
  }
  const nativeAnimation = (value, options) => {
    let id;
    return { start(callback) { id = ++animationId; animations.set(id, { value, options, callback }); },
      stop() { const animation = animations.get(id); animations.delete(id); animation?.callback?.({ finished: false }); }, reset() {} };
  };
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  const availability = node => {
    let pointerEvents = true;
    for (let current = node; current; current = current.parent) {
      if (typeof current.type !== 'string' || !current.type.startsWith('host:')) continue;
      if (Object.assign({}, flatten(current.props.style)).display === 'none') return { hidden: true, acceptsInput: false };
      if (current.props.pointerEvents === 'none') pointerEvents = false;
    }
    return { hidden: false, acceptsInput: pointerEvents };
  };
  const rn = strict('react-native', {
    __esModule: true,
    ...hosts, Platform: { OS: spec.platform, Version: 26, select: values => values[spec.platform] ?? values.native ?? values.default },
    AppState: appState, Alert: { alert: (...args) => alertQueue.push(args) },
    Linking: strict('Linking', { getInitialURL: async () => null, addEventListener: (event, fn) => {
      assert.equal(event, 'url'); linkingListeners.add(fn); return { remove: () => linkingListeners.delete(fn) };
    }, canOpenURL: async () => true, openURL: async url => receipts.push({ host: 'Linking', method: 'openURL', url }), createURL: value => `hither://${value}` }),
    StyleSheet: { create: value => value, flatten, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
    useWindowDimensions: () => dimensions, Dimensions: { get: () => dimensions, addEventListener: () => ({ remove() {} }) },
    Appearance: { setColorScheme() {}, getColorScheme: () => 'dark', addChangeListener: () => ({ remove() {} }) },
    useColorScheme: () => 'dark', Keyboard: { dismiss() {}, metrics: () => undefined, isVisible: () => false, addListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => true, isBoldTextEnabled: async () => false, isHighTextContrastEnabled: async () => false,
      addEventListener: () => ({ remove() {} }), announceForAccessibility() {},
      setAccessibilityFocus: value => receipts.push({ host: 'AccessibilityInfo', method: 'setAccessibilityFocus', value }) },
    findNodeHandle: node => node ? 1 : null,
    I18nManager: { isRTL: false }, PixelRatio: { get: () => 1, getFontScale: () => 1, roundToNearestPixel: value => value },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Animated: { Value: AnimatedValue, View: hosts.View, timing: nativeAnimation, spring: nativeAnimation,
      sequence: nativeAnimation, parallel: nativeAnimation, loop: nativeAnimation, add: (...values) => values[0], multiply: (...values) => values[0] },
    PanResponder: { create: handlers => ({ panHandlers: handlers }) },
    UIManager: { setLayoutAnimationEnabledExperimental() {} },
    LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } },
    Share: { share: async value => { receipts.push({ host: 'Share', method: 'share', value }); return { action: 'sharedAction' }; } },
    FlatList: React.forwardRef(function FlatList(props, ref) { return React.createElement(hosts.ScrollView, { ...props, ref },
      props.ListHeaderComponent && React.createElement(props.ListHeaderComponent),
      props.data.map((item, index) => React.createElement(React.Fragment, { key: props.keyExtractor?.(item, index) ?? index }, props.renderItem({ item, index }))),
      props.ListFooterComponent && React.createElement(props.ListFooterComponent)); }),
  });
  jest.doMock('react-native', () => rn);
  jest.doMock('react-native-safe-area-context', () => ({ SafeAreaProvider: make('SafeAreaProvider'), SafeAreaView: hosts.View,
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
  jest.doMock('@expo/vector-icons', () => strict('vector-icons', { Ionicons: make('Ionicons'), MaterialCommunityIcons: make('MaterialCommunityIcons') }));
  const useShared = value => React.useRef({ value }).current;
  const animation = strict('reanimated', {
    __esModule: true, default: { View: hosts.View, Text: hosts.Text, ScrollView: hosts.ScrollView,
      createAnimatedComponent: component => component },
    makeMutable: value => ({ value }), useSharedValue: useShared, useDerivedValue: fn => ({ value: fn() }), useAnimatedRef: () => React.useRef(null),
    scrollTo: (ref, x, y, animated) => ref.current?.scrollTo({ x, y, animated }),
    useAnimatedStyle: fn => fn(), useAnimatedProps: fn => fn(), useReducedMotion: () => true,
    useFrameCallback: () => React.useRef({ setActive() {} }).current,
    useAnimatedReaction: () => {}, useAnimatedScrollHandler: value => value,
    cancelAnimation() {}, withTiming: value => value, withSpring: value => value, withDelay: (_, value) => value,
    withRepeat: value => value, withSequence: (...values) => values.at(-1), runOnJS: fn => fn,
    interpolate: (value, input, output) => output[0] + (value - input[0]) / (input.at(-1) - input[0]) * (output.at(-1) - output[0]),
    interpolateColor: (_value, _input, output) => output[0],
    Extrapolation: { CLAMP: 'clamp' }, Easing: { linear: value => value, ease: value => value, quad: value => value, cubic: value => value,
      out: fn => fn, in: fn => fn, inOut: fn => fn, bezier: () => value => value },
    LinearTransition: { springify: () => ({ animation: 'LinearTransition' }) },
  });
  for (const name of ['FadeIn', 'FadeInRight', 'FadeOut', 'FadeOutRight', 'ZoomIn', 'ZoomOut']) animation[name] = { duration: value => ({ animation: name, duration: value }) };
  jest.doMock('react-native-reanimated', () => animation);
  jest.doMock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: React.forwardRef(function ReanimatedSwipeable(props, ref) {
    const [open, setOpen] = React.useState(false);
    const currentProps = React.useRef(props);
    currentProps.current = props;
    const methods = React.useRef(null);
    if (!methods.current) methods.current = { close: () => { setOpen(false); currentProps.current.onSwipeableClose?.('right'); } };
    React.useImperativeHandle(ref, () => methods.current, []);
    return React.createElement('host:ReanimatedSwipeable', { ...props, onSwipeableOpen: direction => { setOpen(true); props.onSwipeableOpen?.(direction); } },
      props.children, open && props.renderRightActions?.({ value: 1 }, { value: 1 }, methods.current));
  }) }));
  jest.doMock('@react-native-community/slider', () => ({ __esModule: true, default: make('Slider') }));
  jest.doMock('expo-linear-gradient', () => ({ LinearGradient: make('LinearGradient') }));
  jest.doMock('expo-clipboard', () => strict('Clipboard', { setStringAsync: async value => receipts.push({ host: 'Clipboard', method: 'setStringAsync', value }) }));
  jest.doMock('react-native-maps', () => ({ __esModule: true, default: make('MapView'), Marker: make('Marker'), Polyline: make('Polyline') }));
  jest.doMock('expo', () => strict('expo', { requireNativeView: name => { assert.equal(name, 'HitherSheetPaneTabs'); return make(name); } }));
  const gesture = () => {
    const object = {};
    for (const method of ['onBegin','onStart','onUpdate','onChange','onEnd','onFinalize','enabled','activeOffsetX','activeOffsetY',
      'failOffsetX','failOffsetY','minDistance','maxDistance','minDuration','numberOfTaps','runOnJS','simultaneousWithExternalGesture','requireExternalGestureToFail']) {
      object[method] = (...args) => { object[method + 'Input'] = args; return object; };
    }
    return strict('Gesture', object);
  };
  jest.doMock('react-native-gesture-handler', () => strict('gesture-handler', { GestureHandlerRootView: hosts.View,
    GestureDetector: make('GestureDetector'), Gesture: { Pan: gesture, Tap: gesture, LongPress: gesture, Native: gesture,
      Race: (...values) => values, Simultaneous: (...values) => values, Exclusive: (...values) => values }, ScrollView: hosts.ScrollView }));
  jest.doMock('@shopify/react-native-skia', () => strict('skia', {
    ...Object.fromEntries(['Canvas','Fill','Shader','Path','Group','Circle','Rect','RoundedRect','Text','Image','LinearGradient','BlurMask','Line','DashPathEffect','Paint'].map(name => [name, make(`Skia.${name}`)])),
    Skia: { RuntimeEffect: { Make: source => ({ source }) }, Path: { Make: () => ({ addCircle() {}, moveTo() {}, lineTo() {}, cubicTo() {}, close() {} }) } },
    vec: (x, y) => ({ x, y }),
  }));
  const swiftNames = ['Host','Button','HStack','VStack','ZStack','Image','Text','Spacer','Switch','Slider','Picker','TextField','Menu','Divider','Section','Form','Label','ProgressView','ContextMenu','BottomSheet','Group','RNHostView'];
  jest.doMock('@expo/ui/swift-ui', () => strict('swift-ui', Object.fromEntries(swiftNames.map(name => [name, make(`SwiftUI.${name}`)]))));
  jest.doMock('@expo/ui', () => strict('expo-ui', { Host: make('ExpoUI.Host'), Switch: make('ExpoUI.Switch') }));
  jest.doMock('@expo/ui/community/segmented-control', () => ({ __esModule: true, default: make('SegmentedControl'), SegmentedControl: make('SegmentedControl') }));
  const modifierNames = ['accessibilityLabel','accessibilityHint','buttonStyle','buttonBorderShape','controlSize','font','disabled','frame','foregroundColor',
    'labelStyle','offset','padding','tint','background','cornerRadius','opacity','clipShape','shadow','glassEffect','fixedSize','lineLimit','multilineTextAlignment','environment','tag','rotationEffect','scaleEffect',
    'dynamicTypeSize','minimumScaleFactor','presentationDetents','presentationDragIndicator'];
  jest.doMock('@expo/ui/swift-ui/modifiers', () => strict('swift-ui/modifiers', Object.fromEntries(modifierNames.map(name => [name, (...args) => ({ modifier: name, args })]))));
  jest.doMock('expo-task-manager', () => strict('TaskManager', { __esModule: true,
    defineTask: (name, callback) => { assert(!tasks.has(name), `Task already defined ${name}`); tasks.set(name, callback); },
    isTaskDefined: name => tasks.has(name), isAvailableAsync: async () => true }));
  jest.doMock('expo-haptics', () => strict('Haptics', { selectionAsync: async () => {}, impactAsync: async () => {}, notificationAsync: async () => {},
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' } }));
  jest.doMock('expo-status-bar', () => ({ StatusBar: make('StatusBar') }));
  jest.doMock('@expo-google-fonts/fredoka', () => ({ useFonts: () => [true], Fredoka_500Medium: 1, Fredoka_600SemiBold: 2 }));
  jest.doMock('expo-blur', () => ({ BlurView: make('BlurView') }));
  jest.doMock('expo-glass-effect', () => strict('Glass', { GlassView: make('GlassView'), isLiquidGlassAvailable: () => false }));
  const host = {
    receipts, linkingListeners, tasks, animations,
    nativeView(name) { assert.equal(name, 'HitherMenu'); return make(name); },
    input(input) {
      assert.equal(input.kind, 'animation'); assert.equal(typeof input.finished, 'boolean');
      const ids = input.id == null ? [...animations.keys()] : [input.id];
      for (const id of ids) {
        const animation = animations.get(id); assert(animation, `Unknown animation ${id}`); animations.delete(id);
        if (input.finished && animation.value instanceof AnimatedValue && animation.options) animation.value.setValue(animation.options.toValue);
        animation.callback?.({ finished: input.finished });
      }
    },
    call(root, { kind, testId, label, value, within, phase, success }) {
      if (kind === 'gesture') {
        assert(['onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize'].includes(phase));
        const nodes = root.root.findAll(node => typeof node.type === 'string' && node.type.startsWith('host:') && node.props.testID === testId && availability(node).acceptsInput);
        assert.equal(nodes.length, 1, `Expected one gesture target ${testId}`);
        let detector = nodes[0];
        while (detector && detector.type !== 'host:GestureDetector') detector = detector.parent;
        assert(detector, `No external gesture detector for ${testId}`);
        const gestures = [detector.props.gesture].flat(Infinity).filter(gesture => Object.hasOwn(gesture, `${phase}Input`));
        assert.equal(gestures.length, 1, `Expected one gesture ${phase} callback`);
        if (Object.hasOwn(gestures[0], 'enabledInput') && gestures[0].enabledInput[0] === false) return { invoked: false, reason: 'disabled' };
        receipts.push({ host: 'GestureDetector', kind, testId, phase, value, success });
        gestures[0][`${phase}Input`][0](value, success ?? true);
        return { invoked: true };
      }
      const nativeEvents = ['onLongPress', 'onPress', 'onMapReady', 'onMapLoaded', 'onRegionChangeComplete', 'onUserLocationChange',
        'onSelectionChange', 'onChange', 'onLayout', 'onSelect', 'onValueChange', 'onSlidingComplete', 'onScrollBeginDrag', 'onMomentumScrollEnd', 'onBlur', 'onSwipeableOpen'];
      if (kind === 'nativeEvent') assert(nativeEvents.includes(value?.event), `Unknown native event ${value?.event}`);
      const property = kind === 'nativeEvent' ? value.event : { press: 'onPress', changeText: 'onChangeText', toggle: 'onValueChange', submit: 'onSubmitEditing', selection: 'onSelectionChange' }[kind];
      assert(property, `Unknown host event ${kind}`);
      const visible = node => availability(node).acceptsInput;
      const match = node => visible(node) && typeof node.type === 'string' && node.type.startsWith('host:') &&
        (testId ? node.props.testID === testId : node.props.accessibilityLabel === label || node.props.modifiers?.some(m => m.modifier === 'accessibilityLabel' && m.args[0] === label));
      const scope = within ? root.root.findAll(match => typeof match.type === 'string' && match.props.testID === within) : [root.root];
      assert.equal(scope.length, 1, `Expected one scope ${within}`);
      const endpoints = scope[0].findAll(match).flatMap(node => typeof node.props[property] === 'function' ? [node] : node.findAll(child =>
        visible(child) && typeof child.type === 'string' && child.type.startsWith('host:') && typeof child.props[property] === 'function'));
      const unique = [...new Set(endpoints)];
      assert.equal(unique.length, 1, `Expected one ${kind} endpoint ${testId ?? label}, got ${unique.length}`);
      const node = unique[0];
      const disabled = Boolean(node.props.disabled || node.props.enabled === false || (kind === 'changeText' && node.props.editable === false) || node.props.accessibilityState?.disabled || node.props.modifiers?.some(m => m.modifier === 'disabled' && m.args[0]));
      receipts.push({ host: node.type, kind, testId, label, disabled });
      if (disabled) return { invoked: false, reason: 'disabled' };
      const event = kind === 'nativeEvent' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'event')) : value;
      node.props[property](kind === 'press' ? { nativeEvent: {}, stopPropagation() {} } : event);
      return { invoked: true };
    },
    observeViews(root) {
      const map = root.root.findAll(node => node.type?.render?.name === 'GroupMap')[0];
      const flock = root.root.findAll(node => node.type?.name === 'FlockRow' && !availability(node).hidden);
      return {
        mapMembers: map ? structuredClone(map.props.members) : null,
        flockRows: flock.map(node => ({ userId: node.props.userId, name: node.props.name,
          lastUpdated: node.props.lastUpdated, serverTimeOffsetMs: node.props.serverTimeOffsetMs, solo: node.props.solo, sharingEnabled: node.props.sharingEnabled,
          text: node.findAll(child => child.type === 'host:Text').map(child =>
            child.children.filter(value => typeof value === 'string').join('')).join(' ') })),
      };
    },
    observe(root) {
      return root.root.findAll(node => typeof node.type === 'string' && node.type.startsWith('host:')).map(node => ({
        ...availability(node),
        kind: node.type, testId: node.props.testID, label: node.props.accessibilityLabel ?? node.props.modifiers?.find(m => m.modifier === 'accessibilityLabel')?.args[0],
        disabled: Boolean(node.props.disabled || node.props.accessibilityState?.disabled || node.props.modifiers?.some(m => m.modifier === 'disabled' && m.args[0])),
        value: node.props.value, text: node.children.filter(child => typeof child === 'string').join(''),
        secureTextEntry: node.props.secureTextEntry, selected: node.props.accessibilityState?.selected, checked: node.props.accessibilityState?.checked,
      })).filter(node => !node.hidden && (node.testId || node.label || node.text));
    },
  };
  return host;
};

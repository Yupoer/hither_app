const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createStrict } = require('./runtime.cjs');
const { install } = require('./host.cjs');
const { installNavigation } = require('./app.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

function fixture() {
  const modules = new Map();
  const failures = [];
  const strict = createStrict(message => { failures.push(message); throw new Error(message); });
  const jest = { doMock: (name, factory) => modules.set(name, factory()) };
  const host = install({ jest, spec: { platform: 'ios' }, strict, fatal: assert.fail, appState: {}, alertQueue: [] });
  return { host, modules, failures, jest };
}

test('native hosts retain rows, children, refs and disabled or readonly input semantics', async () => {
  const { host, modules, failures } = fixture();
  const rn = modules.get('react-native');
  const swift = modules.get('@expo/ui/swift-ui');
  let calls = 0;
  const ref = React.createRef();
  let root;
  await act(async () => { root = create(React.createElement(rn.View, null,
    React.createElement(swift.Button, { testID: 'disabled', modifiers: [{ modifier: 'disabled', args: [true] }], onPress: () => calls++ }),
    React.createElement(rn.TextInput, { testID: 'readonly', editable: false, onChangeText: () => calls++ }),
    React.createElement(rn.TextInput, { testID: 'input', ref, onChangeText: () => calls++ }),
    React.createElement(rn.View, { style: { display: 'none' } }, React.createElement(rn.Pressable, { testID: 'hidden', onPress: () => calls++ })),
    React.createElement(rn.FlatList, { data: [1, 2], renderItem: ({ item }) => React.createElement(rn.Pressable, { testID: `row-${item}`, onPress: () => calls++ }) }),
    React.createElement(rn.Pressable, { testID: 'duplicate', onPress: () => calls++ }),
    React.createElement(rn.Pressable, { testID: 'duplicate', onPress: () => calls++ }),
  )); });
  try {
    assert.deepEqual(host.call(root, { kind: 'press', testId: 'disabled' }), { invoked: false, reason: 'disabled' });
    assert.deepEqual(host.call(root, { kind: 'changeText', testId: 'readonly', value: 'blocked' }), { invoked: false, reason: 'disabled' });
    assert.throws(() => host.call(root, { kind: 'press', testId: 'hidden' }), /got 0/);
    assert.throws(() => host.call(root, { kind: 'press', testId: 'duplicate' }), /got 2/);
    assert(!host.observe(root).some(node => node.testId === 'hidden'));
    host.call(root, { kind: 'press', testId: 'row-2' });
    host.call(root, { kind: 'changeText', testId: 'input', value: 'accepted' });
    ref.current.focus();
    modules.get('react-native-reanimated').scrollTo(ref, 10, 20, false);
    assert.equal(calls, 2);
    assert(host.receipts.some(receipt => receipt.method === 'focus'));
    assert(host.receipts.some(receipt => receipt.method === 'scrollTo' && receipt.value.x === 10 && receipt.value.y === 20 && receipt.value.animated === false));
    try { rn.Keyboard.unimplemented(); } catch {}
    assert.deepEqual(failures, ['Unsupported external react-native.Keyboard.unimplemented']);
  } finally { await act(async () => root.unmount()); }
});

test('animation completion is explicit and disabled gesture callbacks stay blocked', async () => {
  const { host, modules } = fixture();
  const rn = modules.get('react-native');
  const gesture = modules.get('react-native-gesture-handler');
  const value = new rn.Animated.Value(0);
  const completed = [];
  rn.Animated.timing(value, { toValue: 1 }).start(result => completed.push(result));
  assert.deepEqual(completed, []);
  host.input({ kind: 'animation', finished: false });
  assert.deepEqual(completed, [{ finished: false }]);
  assert.equal(value.value, 0);
  rn.Animated.timing(value, { toValue: 1 }).start(result => completed.push(result));
  host.input({ kind: 'animation', finished: true });
  assert.equal(value.value, 1);
  let calls = 0;
  const pan = gesture.Gesture.Pan().enabled(false).onEnd(() => calls++);
  let root;
  await act(async () => { root = create(React.createElement(gesture.GestureDetector, { gesture: pan }, React.createElement(rn.View, { testID: 'pan' }))); });
  try {
    assert.deepEqual(host.call(root, { kind: 'gesture', testId: 'pan', phase: 'onEnd', value: { translationY: 100 } }), { invoked: false, reason: 'disabled' });
    assert.equal(calls, 0);
    pan.enabled(true);
    for (const props of [{ style: { display: 'none' } }, { pointerEvents: 'none' }]) {
      await act(async () => root.update(React.createElement(rn.View, props,
        React.createElement(gesture.GestureDetector, { gesture: pan }, React.createElement(rn.View, { testID: 'pan' })))));
      assert.throws(() => host.call(root, { kind: 'gesture', testId: 'pan', phase: 'onEnd', value: {} }), /Expected one gesture target/);
      assert.equal(calls, 0);
    }
    await act(async () => root.update(React.createElement(gesture.GestureDetector, { gesture: pan }, React.createElement(rn.View, { testID: 'pan' }))));
    assert.deepEqual(host.call(root, { kind: 'gesture', testId: 'pan', phase: 'onEnd', value: {} }), { invoked: true });
    assert.equal(calls, 1);
  } finally { await act(async () => root.unmount()); }
});

test('navigation replacement, reset and a new account navigator retain only the current stack', async () => {
  const f = fixture();
  installNavigation({ jest: f.jest, host: f.host });
  const Stack = f.modules.get('@react-navigation/native-stack').createNativeStackNavigator();
  const rn = f.modules.get('react-native');
  function Screen() { return React.createElement(rn.Text, null, 'screen'); }
  const element = key => React.createElement(Stack.Navigator, { key, initialRouteName: 'RoleSelect' },
    ...['RoleSelect', 'Auth', 'Map'].map(name => React.createElement(Stack.Screen, { key: name, name, component: Screen })));
  let root;
  await act(async () => { root = create(element('account-a')); });
  try {
    await act(async () => f.host.navigation.navigate('Auth'));
    await act(async () => f.host.navigation.replace('Map'));
    assert.deepEqual(f.host.route.routes.map(route => route.name), ['RoleSelect', 'Map']);
    await act(async () => f.host.navigation.goBack());
    assert.equal(f.host.route.route, 'RoleSelect');
    await act(async () => f.host.navigation.reset({ index: 0, routes: [{ name: 'Auth' }] }));
    assert.deepEqual(f.host.route.routes.map(route => route.name), ['Auth']);
    await act(async () => root.update(element('account-b')));
    assert.deepEqual(f.host.route.routes.map(route => route.name), ['RoleSelect']);
    assert.equal(f.host.navigation.canGoBack(), false);
  } finally { await act(async () => root.unmount()); }
});

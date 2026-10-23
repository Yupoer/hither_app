const assert = require('node:assert/strict');
exports.installNavigation = ({ jest, host }) => {
  const React = require('react');
  const listeners = new Set();
  const state = { route: null, params: null, routes: [] };
  const nav = {
    navigate: (name, params) => move(name, params), replace: (name, params) => { state.routes.pop(); move(name, params); },
    reset: value => { state.routes = value.routes.slice(0, (value.index ?? 0) + 1); const route = state.routes.at(-1); move(route.name, route.params, false); },
    goBack: () => { const previous = state.routes.at(-2); assert(previous, 'No previous route'); state.routes.pop(); move(previous.name, previous.params, false); },
    canGoBack: () => state.routes.length > 1,
    getParent: () => undefined, setOptions() {}, isFocused: () => true,
    addListener: (event, fn) => { const item = { event, fn }; listeners.add(item); return () => listeners.delete(item); },
  };
  let render;
  let stateChanged;
  function move(name, params, push = true) {
    if (state.route) for (const item of listeners) if (item.event === 'blur') item.fn();
    state.route = name; state.params = params;
    if (push) state.routes.push({ name, params });
    render?.({ name, params });
    stateChanged?.({ index: state.routes.length - 1, routes: state.routes });
  }
  const native = {
    useIsFocused: () => true, useNavigation: () => nav,
    useRoute: () => ({ name: state.route, params: state.params }),
    useFocusEffect: callback => React.useEffect(callback, [callback]),
    DefaultTheme: { colors: {} }, DarkTheme: { colors: {} },
    createNavigationContainerRef: () => ({ ...nav, getRootState: () => ({ index: 0, routes: [{ name: state.route, key: state.route }] }), isReady: () => true }),
    NavigationContainer: React.forwardRef((props, ref) => {
      stateChanged = props.onStateChange;
      React.useEffect(() => { props.onReady?.(); }, []);
      return React.createElement(React.Fragment, null, host.ProviderObservation && React.createElement(host.ProviderObservation), props.children);
    }),
  };
  jest.doMock('@react-navigation/native', () => native);
  jest.doMock('@react-navigation/native-stack', () => ({ createNativeStackNavigator: () => ({
    Navigator: ({ children, initialRouteName }) => {
      const [route, setRoute] = React.useState({ name: initialRouteName, params: undefined });
      render = setRoute;
      React.useEffect(() => { state.routes = [{ name: initialRouteName, params: undefined }]; }, []);
      React.useEffect(() => {
        state.route = route.name; state.params = route.params;
        if (!state.routes.length) state.routes.push(route);
        for (const item of listeners) if (item.event === 'focus') item.fn();
      }, [route]);
      const screens = React.Children.toArray(children).filter(React.isValidElement);
      const screen = screens.find(node => node.props.name === route.name);
      assert(screen, `Unregistered route ${route.name}`);
      return React.createElement(screen.props.component, { navigation: nav, route });
    }, Screen: () => { throw new Error('Screen registration rendered outside navigator'); },
  }) }));
  host.navigation = nav;
  host.route = state;
  host.bindScreenRenderer = callback => { render = callback; };
};

exports.createPresentation = (React, spec, host, app) => {
  const { PreferencesProvider, usePreferences } = require('../../src/state/PreferencesContext');
  const { SessionProvider, useSession } = require('../../src/state/SessionContext');
  const observation = {};
  function Observe() {
    observation.session = app.session = useSession(); observation.preferences = app.preferences = usePreferences();
    observation.invites = app.invites = require('../../src/state/useSubgroupInvites').useSubgroupInvites();
    return null;
  }
  host.ProviderObservation = Observe;
  if (spec.mode === 'app') {
    const App = require('../../App').default;
    return { element: React.createElement(App), observation };
  }
  const paths = { Login: '../../src/screens/LoginScreen', RoleSelect: '../../src/screens/RoleSelectScreen',
    Auth: '../../src/screens/AuthScreen', MyTeams: '../../src/screens/MyTeamsScreen', Map: '../../src/screens/MapScreen',
    PasswordRecovery: '../../src/screens/PasswordRecoveryScreen', Onboarding: '../../src/onboarding/OnboardingScreen',
    Store: '../../src/screens/MapScreen/components/StorePane', Premium: '../../src/components/PremiumPresentation',
    NotificationPreferences: '../../src/components/NotificationPreferencesCard', QuickCommands: '../../src/components/QuickCommandsCard',
    CoordinateDestinationSheet: '../../src/components/CoordinateDestinationSheet', FeedbackSheet: '../../src/components/FeedbackSheet',
    CustomQuickCommandSheet: '../../src/components/CustomQuickCommandSheet', AccountSheetContent: '../../src/components/AccountSheet',
    ProfileOverlay: '../../src/screens/MapScreen/components/ProfileOverlay', SettingsOverlay: '../../src/screens/MapScreen/components/SettingsOverlay',
    DestinationSearch: '../../src/components/DestinationSearch', KmlImportSheet: '../../src/components/KmlImportSheet', NativeObservers: './observers-store.cjs',
    ErrorBoundary: './observers-account.cjs', GroupLoadError: './observers-account.cjs' };
  const namedExports = { Store: 'StorePane', AccountSheetContent: 'AccountSheetContent', ProfileOverlay: 'ProfileOverlay', SettingsOverlay: 'SettingsOverlay', GroupLoadError: 'GroupLoadObserver' };
  assert(paths[spec.screen?.name], `Unsupported real screen ${spec.screen?.name}`);
  function Content() {
    const session = useSession();
    const preferences = usePreferences();
    const { colors } = require('../../src/state/PreferencesContext').useTheme();
    const { t } = require('../../src/i18n').useTranslation();
    const [screen, setScreen] = React.useState(spec.screen);
    React.useEffect(() => { host.route.route = screen.name; host.route.params = screen.params; host.route.routes = [{ name: screen.name, params: screen.params }]; }, []);
    host.mount = next => { assert(paths[next.name], `Unsupported real screen ${next.name}`); setScreen(next); };
    host.bindScreenRenderer(next => host.mount(next));
    const Screen = require(paths[screen.name])[namedExports[screen.name] ?? 'default'];
    app.groupId = screen.params?.groupId ?? session.membership?.group.id ?? null;
    const callbacks = React.useMemo(() => new Map(), [screen.name]);
    const receipt = method => {
      if (!callbacks.has(method)) callbacks.set(method, (...args) => { host.receipts.push({ host: screen.name, method, args }); });
      return callbacks.get(method);
    };
    const componentProps = {
      visible: true, colors, accent: colors.accent, t, styles: {}, slot: 0,
      groupId: app.groupId, group: session.membership?.group, groupName: session.membership?.group.name,
      isAnonymous: session.isAnonymous, personalPremiumActive: session.premiumProjection.personalPremiumActive,
      isLeader: session.membership?.role === 'leader', showRestore: true,
      onClose: receipt('onClose'), onDone: receipt('onDone'), refresh: receipt('refresh'),
      onSubmit: receipt('onSubmit'), onRequireRegistration: receipt('onRequireRegistration'),
      onEntitlementChanged: receipt('onEntitlementChanged'), onOpenSubscribe: receipt('onOpenSubscribe'),
      onPurchaseSuccess: receipt('onPurchaseSuccess'), onRestoreSuccess: receipt('onRestoreSuccess'),
      onEntitlementActivated: receipt('onEntitlementActivated'), onConfigureCustom: receipt('onConfigureCustom'),
      onAccountDeleted: receipt('onAccountDeleted'),
      onHighlightConsumed: receipt('onHighlightConsumed'), onPick: receipt('onPick'), onOpenComplete: receipt('onOpenComplete'),
      onConfirmResetPrefs: receipt('onConfirmResetPrefs'), onConfirmLeave: receipt('onConfirmLeave'),
      onConfirmSignOut: receipt('onConfirmSignOut'), onOpenFeedback: receipt('onOpenFeedback'),
      onImport: receipt('onImport'), onUpgrade: receipt('onUpgrade'), currentCount: 0, remainingQuota: 10, isPro: session.isPro,
      onAppNotice: receipt('onAppNotice'),
      onRetry: receipt('retry'),
    };
    return React.createElement(React.Fragment, null, React.createElement(Observe), !session.initializing && React.createElement(Screen, {
      ...componentProps, ...screen.props, navigation: host.navigation, route: { name: screen.name, params: screen.params },
    }));
  }
  const AppErrorBoundary = require('../../src/components/AppErrorBoundary').default;
  return { element: React.createElement(AppErrorBoundary, null, React.createElement(PreferencesProvider, null, React.createElement(SessionProvider, null, React.createElement(Content)))), observation };
};

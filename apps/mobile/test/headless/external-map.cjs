const assert = require('node:assert/strict');

exports.createExternalMap = function createExternalMap({ strict = (_name, value) => value, spec = {} } = {}) {
  const React = require('react');
  const receipts = [];
  const pending = new Map();
  const files = new Map();
  const datePickers = [];
  const mountedDatePickers = new Map();
  let sequence = 0;
  const state = {
    searchResults: [], searchError: null, holdSearch: false,
    route: null, routeError: null, holdRoute: false,
    proxyStatus: 200, proxyError: null, proxyBodyError: null, proxyRetryAfter: null,
    picker: { canceled: true, assets: null }, pickerError: null,
    readError: null, copyError: null,
  };
  const record = (method, value) => receipts.push({ method, ...(value === undefined ? {} : { value: structuredClone(value) }) });
  const fail = error => { if (error) throw new Error(String(error)); };
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const boundary = (name, module) => strict(name, module);
  function result(kind, value) {
    const id = `maps-${++sequence}`;
    record(kind, { id, ...value });
    const isSearch = kind === 'maps.searchPlaces';
    const response = clone(isSearch ? state.searchResults : state.route);
    const error = isSearch ? state.searchError : state.routeError;
    if (isSearch ? state.holdSearch : state.holdRoute) {
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, response, error }));
    }
    fail(error);
    return Promise.resolve(response);
  }
  const nativeMap = boundary('HitherMaps', {
    searchPlaces: (query, region) => {
      assert.equal(typeof query, 'string');
      return result('maps.searchPlaces', { query, region });
    },
    getDirections: (from, to, mode) => {
      assert(from && to && ['walk', 'drive', 'bicycle', 'transit'].includes(mode));
      return result('maps.getDirections', { from, to, mode });
    },
  });
  const filesystem = boundary('FileSystem', {
    cacheDirectory: 'file:///headless-cache/',
    documentDirectory: 'file:///headless-documents/',
    EncodingType: { Base64: 'base64', UTF8: 'utf8' },
    copyAsync: async ({ from, to }) => {
      record('file.copyAsync', { from, to }); fail(state.copyError);
      assert(files.has(from), 'Unknown fixture source file');
      files.set(to, clone(files.get(from)));
    },
    getInfoAsync: async uri => {
      record('file.getInfoAsync', { uri });
      const file = files.get(uri);
      return file ? { exists: true, uri, size: file.size ?? Buffer.byteLength(file.content, file.encoding ?? 'utf8'), isDirectory: false }
        : { exists: false, uri };
    },
    readAsStringAsync: async (uri, options) => {
      record('file.readAsStringAsync', { uri, options }); fail(state.readError);
      const file = files.get(uri);
      assert(file, 'Unknown fixture file');
      const bytes = Buffer.from(file.content, file.encoding ?? 'utf8');
      return bytes.toString(options?.encoding === 'base64' ? 'base64' : 'utf8');
    },
  });
  const dateModule = {
    __esModule: true,
    default: props => {
      const latest = React.useRef(props);
      latest.current = props;
      React.useEffect(() => {
        const id = ++sequence;
        mountedDatePickers.set(id, latest);
        return () => mountedDatePickers.delete(id);
      }, []);
      return React.createElement('host:DateTimePicker', { ...props, onChange: event => {
        const timestamp = event.nativeEvent?.timestamp;
        latest.current.onChange?.(event, timestamp == null ? undefined : new Date(timestamp));
      } });
    },
    DateTimePickerAndroid: {
      open: options => {
        assert(['date', 'time'].includes(options.mode));
        assert.equal(typeof options.onChange, 'function');
        const id = ++sequence;
        datePickers.push({ id, options });
        record('datePicker.open', { id, mode: options.mode, value: options.value?.toISOString(), minimumDate: options.minimumDate?.toISOString() });
      },
      dismiss: async mode => { record('datePicker.dismiss', mode); },
    },
  };
  const modules = {
    'expo-document-picker': boundary('DocumentPicker', {
      getDocumentAsync: async options => {
        assert.deepEqual(options, { type: ['application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz', '*/*'], copyToCacheDirectory: true });
        record('documentPicker.getDocumentAsync', options); fail(state.pickerError);
        return clone(state.picker);
      },
    }),
    'expo-file-system/legacy': filesystem,
    '@react-native-community/datetimepicker': dateModule,
  };
  return {
    modules,
    nativeModules: { HitherMaps: spec.capabilities?.maps === false ? null : nativeMap },
    handles: kind => ['mapsConfigure', 'mapsResolve', 'mapFile', 'datePicker'].includes(kind),
    input(input) {
      if (input.kind === 'mapsConfigure') {
        assert(input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch));
        for (const [key, value] of Object.entries(input.patch)) {
          assert(Object.hasOwn(state, key), `Unknown maps fixture setting ${key}`);
          state[key] = clone(value);
        }
      } else if (input.kind === 'mapsResolve') {
        const request = pending.get(input.id);
        assert(request, `Unknown held map request ${input.id}`);
        pending.delete(input.id);
        if (input.error ?? request.error) request.reject(new Error(String(input.error ?? request.error)));
        else request.resolve(Object.hasOwn(input, 'result') ? clone(input.result) : request.response);
      } else if (input.kind === 'mapFile') {
        assert.equal(typeof input.uri, 'string');
        assert.equal(typeof input.content, 'string');
        assert(['utf8', 'base64', undefined].includes(input.encoding));
        files.set(input.uri, { content: input.content, encoding: input.encoding, size: input.size });
      } else if (input.kind === 'datePicker') {
        const index = input.id === undefined ? datePickers.length - 1 : datePickers.findIndex(item => item.id === input.id);
        const mounted = input.id === undefined ? [...mountedDatePickers.values()].at(-1) : mountedDatePickers.get(input.id);
        const picker = spec.platform === 'ios' ? mounted && { options: mounted.current } : datePickers[index];
        assert(picker, 'No pending Android date picker');
        if (spec.platform !== 'ios') datePickers.splice(index, 1);
        assert(['set', 'dismissed', 'neutralButtonPressed'].includes(input.type));
        const date = input.timestamp == null ? undefined : new Date(input.timestamp);
        assert(!date || Number.isFinite(date.getTime()));
        picker.options.onChange({ type: input.type, nativeEvent: { timestamp: date?.getTime() } }, date);
      } else throw new Error(`Unknown maps input ${input.kind}`);
    },
    handlesFetch: url => String(url) === 'https://headless.supabase.co/functions/v1/google-maps',
    async fetch(url, options) {
      assert.equal(String(url), 'https://headless.supabase.co/functions/v1/google-maps');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert(['search', 'route'].includes(body.action));
      assert(options.headers.Authorization?.startsWith('Bearer fixture-'));
      record('maps.proxy', body);
      fail(state.proxyError);
      const payload = state.proxyStatus === 200
        ? body.action === 'search' ? { action: 'search', places: clone(state.searchResults) }
          : { action: 'route', route: clone(state.route) }
        : { error: state.proxyBodyError ?? 'quota_exceeded' };
      return { ok: state.proxyStatus >= 200 && state.proxyStatus < 300, status: state.proxyStatus,
        headers: { get: name => name.toLowerCase() === 'retry-after' ? state.proxyRetryAfter : null }, json: async () => payload };
    },
    observe: () => ({ receipts: clone(receipts), pending: [...pending.keys()],
      datePickers: [...datePickers, ...[...mountedDatePickers].map(([id, latest]) => ({ id, options: latest.current }))]
        .map(({ id, options }) => ({ id, mode: options.mode, value: options.value?.toISOString() })) }),
    dispose: () => ({ pending: pending.size, datePickers: datePickers.length + mountedDatePickers.size }),
  };
};

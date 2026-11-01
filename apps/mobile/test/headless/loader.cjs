const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

exports.install = function install({ mobileRoot }) {
  const originalLoad = Module._load;
  const originalResolve = Module._resolveFilename;
  const originalExtensions = new Map(Object.entries(Module._extensions));
  const actorConfigPath = path.join(mobileRoot, 'test/headless/actor.config.cjs');
  const actorConfig = require(actorConfigPath);
  const baseConfigPath = path.join(mobileRoot, 'jest.config.js');
  const resolvePlatform = require('./resolver.cjs');
  const defaultResolver = require(path.join(path.dirname(require.resolve('jest-resolve')), 'defaultResolver.js')).default;
  const defaults = require(path.join(path.dirname(require.resolve('jest-config')), 'Defaults.js')).default;
  const asset = require(path.join(mobileRoot, 'test/headless/asset.cjs'));
  const { ModernFakeTimers } = require('@jest/fake-timers');
  const sourceMaps = new Map();
  require('source-map-support').install({
    environment: 'node',
    handleUncaughtExceptions: false,
    retrieveSourceMap: filename => sourceMaps.has(filename) ? { url: filename, map: sourceMaps.get(filename) } : null,
  });

  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const fingerprint = filename => fs.existsSync(filename) ? hash(fs.readFileSync(filename)) : null;
  const tsJestRoot = path.dirname(require.resolve('ts-jest/package.json'));
  const baseFingerprint = hash(JSON.stringify({
    mobileRoot,
    node: process.version,
    executable: process.execPath,
    inputs: [module.filename, path.join(__dirname, 'actor.cjs'), baseConfigPath, actorConfigPath,
      path.join(mobileRoot, 'package-lock.json'), require.resolve('typescript/package.json'),
      path.join(tsJestRoot, 'package.json'), path.join(tsJestRoot, 'dist/legacy/compiler/ts-compiler.js'),
      path.join(tsJestRoot, 'dist/legacy/config/config-set.js'),
      path.join(tsJestRoot, 'dist/legacy/ts-jest-transformer.js'),
      path.join(path.dirname(require.resolve('jest-config')), 'Defaults.js')].map(filename => [filename, fingerprint(filename)]),
  }));
  assert.equal(process.env.TS_JEST_HOOKS, undefined, 'Headless cache does not support TS_JEST_HOOKS');
  const cacheDirectory = path.join(mobileRoot, 'node_modules/.cache/hither-headless/compiled', baseFingerprint);
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const metadataPath = path.join(cacheDirectory, 'metadata.json');
  let metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  if (metadata && !metadata.inputs.every(input => fingerprint(input.filename) === input.hash)) metadata = null;
  let transformer;
  let transformOptions;

  function publish(filename, contents) {
    const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, filename);
  }

  function initializeTransformer() {
    const ts = require('typescript');
    const { default: tsJest } = require('ts-jest');
    const tsTransform = Object.values(actorConfig.transform).find(value => Array.isArray(value) && value[0] === 'ts-jest');
    assert(tsTransform, 'Existing actor must use ts-jest');
    transformer = tsJest.createTransformer(tsTransform[1]);
    const config = { ...actorConfig, rootDir: mobileRoot, cwd: mobileRoot, cache: false };
    transformOptions = {
      config, configString: JSON.stringify(config), cacheFS: new Map(), instrument: false,
      supportsDynamicImport: false, supportsStaticESM: false, supportsExportNamespaceFrom: false, supportsTopLevelAwait: false,
    };
    const inputs = new Map();
    const readFile = ts.sys.readFile;
    const fileExists = ts.sys.fileExists;
    ts.sys.readFile = (...args) => {
      const result = readFile(...args);
      inputs.set(path.resolve(args[0]), result === undefined ? null : fingerprint(args[0]));
      return result;
    };
    ts.sys.fileExists = filename => {
      const result = fileExists(filename);
      inputs.set(path.resolve(filename), result ? fingerprint(filename) : null);
      return result;
    };
    let configSet;
    try {
      configSet = transformer._configsFor(transformOptions);
    } finally {
      ts.sys.readFile = readFile;
      ts.sys.fileExists = fileExists;
    }
    const compiler = transformer._compiler._compilerInstance;
    const compilerOptions = compiler.fixupCompilerOptionsForModuleKind(configSet.parsedTsConfig.options, false);
    metadata = {
      inputs: [...inputs].map(([filename, inputHash]) => ({ filename, hash: inputHash })),
      parsedOptions: configSet.parsedTsConfig.options,
      compilerOptions,
      isolatedModules: configSet.isolatedModules,
    };
    assert.equal(metadata.isolatedModules, true, 'Headless actor requires existing isolated compilation');
    metadata.signature = hash(JSON.stringify(metadata));
    publish(metadataPath, JSON.stringify(metadata, null, 2));
  }

  function compile(module, filename) {
    if (filename.includes(`${path.sep}node_modules${path.sep}`)) {
      return (originalExtensions.get(path.extname(filename)) ?? originalExtensions.get('.js'))(module, filename);
    }
    const source = fs.readFileSync(filename, 'utf8');
    if (!metadata) initializeTransformer();
    let cacheFile = path.join(cacheDirectory, `${hash(JSON.stringify([metadata.signature, filename, source]))}.json`);
    let output;
    if (fs.existsSync(cacheFile)) {
      output = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } else {
      if (!transformer) initializeTransformer();
      cacheFile = path.join(cacheDirectory, `${hash(JSON.stringify([metadata.signature, filename, source]))}.json`);
      output = transformer.process(source, filename, transformOptions);
      publish(cacheFile, JSON.stringify(output));
    }
    const inlineMap = /sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([^\s]+)/.exec(output.code);
    if (inlineMap) sourceMaps.set(filename, JSON.parse(Buffer.from(inlineMap[1], 'base64').toString('utf8')));
    module._compile(output.code, filename);
  }

  const factories = new Map();
  const mocks = new Map();
  const timerNames = ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const originalTimers = new Map(timerNames.map(name => [name, globalThis[name]]));
  const timerHost = Object.create(globalThis);
  for (const name of [...timerNames, 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'process']) {
    Object.defineProperty(timerHost, name, { value: globalThis[name], writable: true, configurable: true, enumerable: true });
  }
  const fakeTimers = new ModernFakeTimers({ global: timerHost, config: { fakeTimers: actorConfig.fakeTimers ?? {} } });
  const jest = {
    doMock(name, factory) { factories.set(name, factory); return jest; },
    useFakeTimers(options) {
      fakeTimers.useFakeTimers(options);
      for (const name of timerNames) globalThis[name] = timerHost[name];
      return jest;
    },
    advanceTimersByTimeAsync: ms => fakeTimers.advanceTimersByTimeAsync(ms),
    getTimerCount: () => fakeTimers.getTimerCount(),
    clearAllTimers: () => fakeTimers.clearAllTimers(),
    useRealTimers() {
      fakeTimers.useRealTimers();
      for (const [name, value] of originalTimers) globalThis[name] = value;
      return jest;
    },
  };

  const extensions = (actorConfig.moduleFileExtensions ?? defaults.moduleFileExtensions).map(extension => `.${extension}`);
  const conditions = ['require', 'default', ...(actorConfig.testEnvironmentOptions?.customExportConditions ?? ['node', 'node-addons'])];
  // Jest's resolver lazily loads its own dependencies through Node.
  let resolving = false;
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (Module.isBuiltin(request) || resolving) return originalResolve.call(this, request, parent, isMain, options);
    resolving = true;
    try {
      return resolvePlatform(request, {
        basedir: parent?.filename ? path.dirname(parent.filename) : mobileRoot,
        extensions, conditions, rootDir: mobileRoot,
        moduleDirectory: actorConfig.moduleDirectories ?? defaults.moduleDirectories,
        paths: options?.paths ?? actorConfig.modulePaths,
        defaultResolver,
      });
    } finally {
      resolving = false;
    }
  };
  Module._load = function load(request, parent, isMain) {
    if (factories.has(request)) {
      if (!mocks.has(request)) mocks.set(request, factories.get(request)());
      return mocks.get(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = compile;
  for (const extension of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ttf']) {
    Module._extensions[extension] = (module, filename) => module._compile(asset.process('', filename).code, filename);
  }

  return {
    jest,
    cleanup() {
      jest.useRealTimers();
      Module._load = originalLoad;
      Module._resolveFilename = originalResolve;
      for (const extension of ['.ts', '.tsx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ttf']) {
        if (originalExtensions.has(extension)) Module._extensions[extension] = originalExtensions.get(extension);
        else delete Module._extensions[extension];
      }
    },
  };
};

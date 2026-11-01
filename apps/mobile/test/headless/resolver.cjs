const fs = require('node:fs');
const path = require('node:path');
const spec = JSON.parse(process.env.HITHER_HEADLESS_DEVICE || '{}');
const platform = spec.platform || 'ios';
const entries = new Map();
const caseKey = process.platform === 'win32' ? name => name.toLowerCase() : name => name;
let log;
function exists(file) {
  const directory = path.dirname(file);
  const key = directory;
  if (!entries.has(key)) {
    entries.set(key, new Set(fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()
      ? fs.readdirSync(directory).map(caseKey) : []));
  }
  return entries.get(key).has(caseKey(path.basename(file))) && fs.existsSync(file);
}
module.exports = (request, options) => {
  const record = resolved => {
    if (spec.directory && /[\\/]src[\\/]|[\\/]App\.tsx$/.test(resolved) && !resolved.includes('node_modules')) {
      if (log === undefined) {
        log = fs.openSync(path.join(spec.directory, 'resolved.jsonl'), 'a');
        process.once('exit', () => fs.closeSync(log));
      }
      fs.writeSync(log, JSON.stringify({ request, resolved }) + '\n');
    }
    return resolved;
  };
  if (request.startsWith('.') && !options.basedir.includes('node_modules')) {
    const target = path.resolve(options.basedir, request);
    const ext = path.extname(target);
    const stem = ['.ts', '.tsx', '.js', '.jsx'].includes(ext) ? target.slice(0, -ext.length) : target;
    if (!/\.(ios|android|native)$/.test(stem)) {
      for (const suffix of [platform, 'native']) for (const extension of ['.ts', '.tsx', '.js', '.jsx']) {
        for (const candidate of [`${stem}.${suffix}${extension}`, path.join(stem, `index.${suffix}${extension}`)]) {
          if (exists(candidate)) return record(candidate);
        }
      }
    }
  }
  return record(options.defaultResolver(request, options));
};

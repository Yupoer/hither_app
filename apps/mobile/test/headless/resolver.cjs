const fs = require('node:fs');
const path = require('node:path');
module.exports = (request, options) => {
  const spec = JSON.parse(process.env.HITHER_HEADLESS_DEVICE || '{}');
  const platform = spec.platform || 'ios';
  const record = resolved => {
    if (spec.directory && /[\\/]src[\\/]|[\\/]App\.tsx$/.test(resolved) && !resolved.includes('node_modules')) {
      fs.appendFileSync(path.join(spec.directory, 'resolved.jsonl'), JSON.stringify({ request, resolved }) + '\n');
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
          if (fs.existsSync(candidate)) return record(candidate);
        }
      }
    }
  }
  return record(options.defaultResolver(request, options));
};

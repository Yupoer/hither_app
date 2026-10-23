exports.process = (_source, filename) => ({ code: `module.exports = ${JSON.stringify(filename)};` });

const { DatabaseSync } = require('node:sqlite');

exports.open = function open(path) {
  const raw = new DatabaseSync(path);
  const bind = params => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  let serial = Promise.resolve();
  const transaction = work => {
    const next = serial.then(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(db);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        try { raw.exec('ROLLBACK'); } catch {}
        throw error;
      }
    });
    serial = next.catch(() => {});
    return next;
  };
  const db = {
    raw,
    execAsync: async sql => { raw.exec(sql); },
    runAsync: async (sql, ...params) => {
      const result = raw.prepare(sql).run(...bind(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getFirstAsync: async (sql, ...params) => raw.prepare(sql).get(...bind(params)) ?? null,
    getAllAsync: async (sql, ...params) => raw.prepare(sql).all(...bind(params)),
    withExclusiveTransactionAsync: transaction,
    withTransactionAsync: transaction,
    closeAsync: async () => { await serial; raw.close(); },
  };
  return db;
};

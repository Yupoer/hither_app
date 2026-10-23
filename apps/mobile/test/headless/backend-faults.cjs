const assert = require('node:assert/strict');
const rpcArguments = { get_premium_projection: 'p_group_id', delete_anonymous_account: '', delete_account: '', clear_anonymous_expiry_if_registered: 'p_uid' };

function failNext(b, match, error) {
  assert(match && Object.keys(match).every(key => ['kind', 'name', 'mode', 'userId'].includes(key)), 'Fault match contract');
  if (match.kind === 'table') {
    const schema = require('./backend-domain.cjs').schemas[match.name];
    assert(schema && schema.modes.includes(match.mode), 'Fault requires a known table operation');
  } else assert(match.kind === 'rpc' && Object.hasOwn(rpcArguments, match.name) && match.mode === undefined, 'Fault requires an explicitly supported RPC');
  assert(error && typeof error.message === 'string' && Object.keys(error).every(key => ['message', 'code', 'details', 'hint', 'status'].includes(key)), 'Fault error contract');
  b.failures.push({ ...structuredClone(match), error: structuredClone(error) });
}

function take(b, operation, mode) {
  if (operation.kind === 'rpc' && !Object.hasOwn(rpcArguments, operation.name)) return undefined;
  const index = b.failures.findIndex(f => f.kind === operation.kind && f.name === operation.name && (f.userId === undefined || f.userId === operation.userId) && (f.mode === undefined || f.mode === mode));
  if (index < 0) return undefined;
  if (operation.kind === 'rpc') require('./backend-domain.cjs').keys(operation.args, rpcArguments[operation.name]);
  return { data: null, error: b.failures.splice(index, 1)[0].error };
}
module.exports = { failNext, take };

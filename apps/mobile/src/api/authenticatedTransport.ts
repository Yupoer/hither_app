import {
  getDefaultAuthRecovery,
  type AuthRecoveryController,
} from './authRecovery';

type AnyClient = Record<string, any>;

const MUTATION_QUERY_METHODS = new Set([
  'insert',
  'update',
  'upsert',
  'delete',
]);

/** RPCs whose names describe reads and therefore do not need a mutation gate. */
const DEFAULT_READ_ONLY_RPC_NAMES = new Set([
  'get_group_recovery_snapshot',
  'get_kml_import_quota',
  'get_premium_projection',
  'get_trip_entitlement',
  'get_store_snapshot',
  'list_my_pending_location_refreshes',
]);

export interface AuthenticatedTransportOptions {
  authRecovery?: AuthRecoveryController;
  readOnlyRpcNames?: ReadonlySet<string>;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null)
    || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function';
}

function controllerFor(options: AuthenticatedTransportOptions): AuthRecoveryController {
  return options.authRecovery ?? getDefaultAuthRecovery();
}

function isReadOnlyRpc(
  name: string,
  explicit: ReadonlySet<string> | undefined,
): boolean {
  if (explicit?.has(name) || DEFAULT_READ_ONLY_RPC_NAMES.has(name)) return true;
  // New read RPCs follow the existing get_/list_/fetch_ naming convention.
  // `get_or_create_*` remains a mutation and is intentionally excluded.
  return /^(?:get|list|fetch)_/.test(name) && !/^get_or_create_/.test(name);
}

function queryPromise(builder: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isThenable(builder)) {
      resolve(builder);
      return;
    }
    builder.then(resolve, reject);
  });
}

function guardBuilder(
  builder: unknown,
  operation: string,
  mutation: boolean,
  authRecovery: AuthRecoveryController,
): any {
  if (!builder || (typeof builder !== 'object' && typeof builder !== 'function')) {
    return builder;
  }

  return new Proxy(builder as object, {
    get(target, property, receiver) {
      if (property === 'then' && typeof (target as { then?: unknown }).then === 'function') {
        const originalThen = (target as { then: (resolve: unknown, reject?: unknown) => unknown }).then;
        // PostgREST's then reads this.fetch and awaits native Promises. Running
        // it with the Proxy receiver recursively proxies those Promises and
        // breaks their constructor/receiver invariants (including Hermes).
        if (!mutation) return originalThen.bind(target);
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          authRecovery
            .withAuthenticatedOperation(
              () => queryPromise({ then: originalThen.bind(target) }),
              { operation, mutation: true, recoverOnce: true },
            )
            .then(resolve, reject);
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        const nextMutation = mutation || (
          typeof property === 'string' && MUTATION_QUERY_METHODS.has(property)
        );
        return guardBuilder(next, operation, nextMutation, authRecovery);
      };
    },
  });
}

/**
 * Guard Supabase mutations before they can reach PostgREST.
 *
 * The proxy checks/refreshes the session before invoking the underlying
 * builder. If Supabase still returns an auth failure, the same operation gets
 * one refresh-and-retry. A missing session therefore fails before any request
 * is sent as anon; the caller's durable outbox remains untouched.
 */
export function withAuthenticatedTransport<T extends AnyClient>(
  client: T,
  options: AuthenticatedTransportOptions = {},
): T {
  const authRecovery = controllerFor(options);
  const readOnlyRpcNames = options.readOnlyRpcNames;

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'rpc') {
        const rpc = Reflect.get(target, property, receiver);
        if (typeof rpc !== 'function') return rpc;
        return (name: string, ...args: unknown[]) => {
          if (isReadOnlyRpc(name, readOnlyRpcNames)) {
            return rpc.apply(target, [name, ...args]);
          }
          // Supabase RPC returns a lazy PostgREST builder. Keep that builder
          // intact so callers can attach abortSignal(), select(), single(),
          // maybeSingle(), throwOnError(), etc. Auth is checked only when the
          // builder is awaited, immediately before the network request.
          return guardBuilder(
            rpc.apply(target, [name, ...args]),
            `api.rpc.${name}`,
            true,
            authRecovery,
          );
        };
      }

      if (property === 'from') {
        const from = Reflect.get(target, property, receiver);
        if (typeof from !== 'function') return from;
        return (table: string) => guardBuilder(
          from.apply(target, [table]),
          `api.from.${table}`,
          false,
          authRecovery,
        );
      }

      return Reflect.get(target, property, receiver);
    },
  }) as T;
}

export { DEFAULT_READ_ONLY_RPC_NAMES };

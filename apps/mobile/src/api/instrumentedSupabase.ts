import { traceApi } from '../state/performance';

type AnyClient = Record<string, any>;

function traceBuilder(builder: any, operation: string): any {
  if (!builder || typeof builder !== 'object') return builder;

  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property === 'then' && typeof target.then === 'function') {
        return (resolve: unknown, reject: unknown) =>
          traceApi(operation, () => target.then(resolve, reject));
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => traceBuilder(value.apply(target, args), operation);
    },
  });
}

export function withSupabasePerformanceTracing<T extends AnyClient>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'from') {
        return (table: string) =>
          traceBuilder(target.from(table), `api.from.${table}`);
      }
      if (property === 'rpc') {
        return (name: string, ...args: unknown[]) =>
          traceBuilder(target.rpc(name, ...args), `api.rpc.${name}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

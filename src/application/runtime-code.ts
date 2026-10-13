import ts from "typescript";
import vm from "node:vm";
import type { EntityOperationContext, EntityOperationMiddleware } from "./entity-runtime";
import { ValidationError } from "./entity-runtime";
import type { CrudAction } from "../domain/request";
import type { EntityRecord } from "../domain/entity";

type RuntimeProgram = Partial<Record<CrudAction, (context: BusinessContext, next: () => Promise<void>) => Promise<void> | void>>;

/**
 * Stable, transport-independent capabilities exposed to uploaded domain code.
 * They are deliberately expressed in terms of records, not repositories or HTTP.
 */
export interface BusinessContext {
  readonly action: CrudAction;
  readonly input?: Record<string, unknown> | Record<string, unknown>[];
  readonly current?: EntityRecord;
  result?: EntityRecord | EntityRecord[];
  records: {
    count(entityName: string, namespace?: string): number;
    get(entityName: string, id: string, namespace?: string): EntityRecord | undefined;
    create(entityName: string, value: Record<string, unknown>, namespace?: string): Promise<EntityRecord>;
    update(entityName: string, id: string, changes: Record<string, unknown>, namespace?: string): Promise<EntityRecord>;
    remove(entityName: string, id: string, namespace?: string): Promise<void>;
  };
  collection(entityName: string, namespace?: string): {
    count(): number;
    get(id: string): EntityRecord | undefined;
    create(value: Record<string, unknown>): Promise<EntityRecord>;
    update(id: string, changes: Record<string, unknown>): Promise<EntityRecord>;
    remove(id: string): Promise<void>;
  };
  fail(message: string): never;
}

const actions: CrudAction[] = ["create", "bulkCreate", "list", "get", "replace", "update", "delete"];

/**
 * Development-mode runtime compiler for a TypeScript domain module received by the entity catalog.
 * It purposefully has no imports, require, process, filesystem, or HTTP capabilities.
 * This is not a security sandbox and must not be exposed to untrusted callers.
 */
export function compileRuntimeCode(value: unknown): Partial<Record<CrudAction, EntityOperationMiddleware>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new ValidationError("code must be a non-empty TypeScript module string");

  const program = evaluate(value);
  const operations: Partial<Record<CrudAction, EntityOperationMiddleware>> = {};
  for (const [action, handler] of Object.entries(program)) {
    if (!actions.includes(action as CrudAction)) throw new ValidationError(`Unsupported code operation: ${action}`);
    if (typeof handler !== "function") throw new ValidationError(`code.${action} must be a function`);
    operations[action as CrudAction] = async (context, next) => handler(businessContext(context), next);
  }
  return operations;
}

function evaluate(source: string): RuntimeProgram {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
    reportDiagnostics: true
  });
  const diagnostic = transpiled.diagnostics?.find(({ category }) => category === ts.DiagnosticCategory.Error);
  if (diagnostic) throw new ValidationError(`Invalid runtime code: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);

  const module = { exports: {} as Record<string, unknown> };
  try {
    vm.runInNewContext(transpiled.outputText, { module, exports: module.exports }, { filename: "runtime-entity.ts", timeout: 1000 });
  } catch (error) {
    throw new ValidationError(`Could not install runtime code: ${errorMessage(error)}`);
  }
  const exported = module.exports.default ?? module.exports;
  if (!isObject(exported)) throw new ValidationError("Runtime code must export a default object of CRUD functions");
  return exported as RuntimeProgram;
}

function businessContext(context: EntityOperationContext): BusinessContext {
  const execute = async (
    action: CrudAction,
    entityName: string,
    namespace: string | undefined,
    id?: string,
    value?: Record<string, unknown>
  ): Promise<EntityRecord | EntityRecord[] | undefined> => context.runtime.execute({
    apiVersion: context.request.apiVersion,
    namespace,
    entityName,
    action,
    id,
    payload: value === undefined ? undefined : { kind: "one", value }
  });

  const records = {
    count: (entityName: string, namespace?: string) => context.runtime.count(entityName, namespace),
    get: (entityName: string, id: string, namespace?: string) => context.runtime.findRecord(entityName, id, namespace),
    create: async (entityName: string, value: Record<string, unknown>, namespace?: string) => requiredRecord(await execute("create", entityName, namespace, undefined, value)),
    update: async (entityName: string, id: string, changes: Record<string, unknown>, namespace?: string) => requiredRecord(await execute("update", entityName, namespace, id, changes)),
    remove: async (entityName: string, id: string, namespace?: string) => { await execute("delete", entityName, namespace, id); }
  };
  return {
    get action() { return context.request.action; },
    get input() { return context.input; },
    get current() { return context.current; },
    get result() { return context.result; },
    set result(value) { context.result = value; },
    records,
    collection: (entityName, namespace) => ({
      count: () => records.count(entityName, namespace),
      get: (id) => records.get(entityName, id, namespace),
      create: (value) => records.create(entityName, value, namespace),
      update: (id, changes) => records.update(entityName, id, changes, namespace),
      remove: (id) => records.remove(entityName, id, namespace)
    }),
    fail(message) { throw new ValidationError(message); }
  };
}

function requiredRecord(value: EntityRecord | EntityRecord[] | undefined): EntityRecord {
  if (!value || Array.isArray(value)) throw new Error("Expected one record from runtime operation");
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

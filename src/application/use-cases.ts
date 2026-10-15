import ts from "typescript";
import vm from "node:vm";
import type { EntityRuntime } from "./entity-runtime";
import { ValidationError, EntityNotFoundError } from "./entity-runtime";
import type { EntityRecord } from "../domain/entity";

export type UseCaseInput = { name: string; entity: string; namespace?: string; minItems?: number; maxItems?: number };
export type UseCaseDefinition = { useCaseId: string; name: string; icon?: string; route: { entity: string; namespace?: string; action: string; method?: string }; inputs: UseCaseInput[]; code: string };
export type ResolvedInputs = Record<string, EntityRecord[]>;
type UseCaseHandler = (context: { inputs: ResolvedInputs; records: ReturnType<typeof records>; fail: (message: string) => never }) => unknown | Promise<unknown>;

export function routeForUseCase(definition: UseCaseDefinition): string {
  return `/v1/${definition.route.namespace ? `${definition.route.namespace}/` : ""}${definition.route.entity}/${definition.route.action}`;
}

export function installedUseCases(runtime: EntityRuntime): UseCaseDefinition[] {
  if (!runtime.has("useCases")) return [];
  return runtime.listRecords("useCases").map((record) => normalize(record));
}

export async function executeUseCase(runtime: EntityRuntime, definition: UseCaseDefinition, value: unknown, language = "en"): Promise<unknown> {
  const supplied = value && typeof value === "object" && !Array.isArray(value) ? (value as { inputs?: unknown }).inputs : undefined;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new ValidationError("UseCase body must contain an inputs object");
  const inputs: ResolvedInputs = {};
  for (const input of definition.inputs) {
    const ids = (supplied as Record<string, unknown>)[input.name];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new ValidationError(`UseCase input ${input.name} must be an array of record IDs`);
    if (input.minItems !== undefined && ids.length < input.minItems) throw new ValidationError(`UseCase input ${input.name} requires at least ${input.minItems} record(s)`);
    if (input.maxItems !== undefined && ids.length > input.maxItems) throw new ValidationError(`UseCase input ${input.name} accepts at most ${input.maxItems} record(s)`);
    inputs[input.name] = ids.map((id) => {
      const record = runtime.findRecord(input.entity, id, input.namespace);
      if (!record) throw new EntityNotFoundError(`UseCase input ${input.name} contains an unknown record`);
      return record;
    });
  }
  const handler = compile(definition.code);
  return handler({ inputs, records: records(runtime), fail: (message: string) => { throw new ValidationError(runtime.localize(language, message, message)); } });
}

function normalize(record: EntityRecord): UseCaseDefinition {
  const route = record.route;
  const inputs = record.inputs;
  if (typeof record.useCaseId !== "string" || typeof record.name !== "string" || typeof record.code !== "string" || !route || typeof route !== "object" || Array.isArray(route) || !Array.isArray(inputs)) throw new ValidationError("Invalid UseCase definition");
  const value = route as Record<string, unknown>;
  if (typeof value.entity !== "string" || typeof value.action !== "string" || (value.namespace !== undefined && typeof value.namespace !== "string") || (value.method !== undefined && String(value.method).toUpperCase() !== "POST")) throw new ValidationError("UseCase route must define entity, action, optional namespace, and POST method");
  return { useCaseId: record.useCaseId, name: record.name, ...(typeof record.icon === "string" ? { icon: record.icon } : {}), route: { entity: value.entity, action: value.action, ...(typeof value.namespace === "string" ? { namespace: value.namespace } : {}), method: "POST" }, inputs: inputs.map((input) => normalizeInput(input)), code: record.code };
}

function normalizeInput(value: unknown): UseCaseInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("UseCase inputs must be objects");
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || typeof input.entity !== "string") throw new ValidationError("UseCase inputs require name and entity");
  return { name: input.name, entity: input.entity, ...(typeof input.namespace === "string" ? { namespace: input.namespace } : {}), ...(Number.isInteger(input.minItems) ? { minItems: Number(input.minItems) } : {}), ...(Number.isInteger(input.maxItems) ? { maxItems: Number(input.maxItems) } : {}) };
}

function compile(source: string): UseCaseHandler {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  try { vm.runInNewContext(output, { module, exports: module.exports }, { filename: "runtime-usecase.ts", timeout: 1000 }); }
  catch (error) { throw new ValidationError(`Could not install UseCase code: ${error instanceof Error ? error.message : String(error)}`); }
  const handler = module.exports.default ?? module.exports.execute;
  if (typeof handler !== "function") throw new ValidationError("UseCase code must export a default function");
  return handler as UseCaseHandler;
}

function records(runtime: EntityRuntime) {
  return {
    get: (entity: string, id: string, namespace?: string) => runtime.findRecord(entity, id, namespace),
    update: async (entity: string, id: string, changes: Record<string, unknown>, namespace?: string) => runtime.execute({ apiVersion: "v1", entityName: entity, namespace, action: "update", id, payload: { kind: "one", value: changes } }),
    create: async (entity: string, value: Record<string, unknown>, namespace?: string) => runtime.execute({ apiVersion: "v1", entityName: entity, namespace, action: "create", payload: { kind: "one", value } })
  };
}

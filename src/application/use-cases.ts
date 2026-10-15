import ts from "typescript";
import vm from "node:vm";
import type { EntityRuntime } from "./entity-runtime";
import { ValidationError, EntityNotFoundError } from "./entity-runtime";
import type { EntityRecord } from "../domain/entity";

export type UseCaseInput = { name: string; entity: string; namespace?: string; minItems?: number; maxItems?: number };
export type UseCaseParameter = { name: string; type?: "string" | "number" | "boolean"; control?: "text" | "date" | "datetime" | "number" | "checkbox"; required?: boolean; default?: unknown };
export type EnableCondition = { all?: Array<{ field: string; equals?: unknown; empty?: boolean }> };
export type UseCaseDefinition = { useCaseId: string; name: string; description?: string; icon?: string; route: { entity: string; namespace?: string; action: string; method?: string }; inputs: UseCaseInput[]; parameters?: UseCaseParameter[]; enableCondition?: EnableCondition; code: string };
export type ResolvedInputs = Record<string, EntityRecord[]>;
type UseCaseHandler = (context: { inputs: ResolvedInputs; parameters: Record<string, unknown>; records: ReturnType<typeof records>; fail: (message: string) => never }) => unknown | Promise<unknown>;

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
    if (definition.enableCondition && inputs[input.name].some((record) => !matchesEnableCondition(record, definition.enableCondition!))) throw new ValidationError("One or more selected records do not allow this operation");
  }
  const parameters = (value as { parameters?: unknown }).parameters ?? {};
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new ValidationError("UseCase parameters must be an object");
  for (const parameter of definition.parameters ?? []) if (parameter.required && (parameters as Record<string, unknown>)[parameter.name] === undefined) throw new ValidationError(`UseCase parameter ${parameter.name} is required`);
  const handler = compile(definition.code);
  return handler({ inputs, parameters: parameters as Record<string, unknown>, records: records(runtime), fail: (message: string) => { throw new ValidationError(runtime.localize(language, message, message)); } });
}

function normalize(record: EntityRecord): UseCaseDefinition {
  const route = record.route;
  const inputs = record.inputs, parameters = record.parameters, enableCondition = record.enableCondition;
  if (typeof record.useCaseId !== "string" || typeof record.name !== "string" || typeof record.code !== "string" || !route || typeof route !== "object" || Array.isArray(route) || !Array.isArray(inputs)) throw new ValidationError("Invalid UseCase definition");
  const value = route as Record<string, unknown>;
  if (typeof value.entity !== "string" || typeof value.action !== "string" || (value.namespace !== undefined && typeof value.namespace !== "string") || (value.method !== undefined && String(value.method).toUpperCase() !== "POST")) throw new ValidationError("UseCase route must define entity, action, optional namespace, and POST method");
  if (parameters !== undefined && !Array.isArray(parameters)) throw new ValidationError("UseCase parameters must be an array");
  return { useCaseId: record.useCaseId, name: record.name, ...(typeof record.description === "string" ? { description: record.description } : {}), ...(typeof record.icon === "string" ? { icon: record.icon } : {}), route: { entity: value.entity, action: value.action, ...(typeof value.namespace === "string" ? { namespace: value.namespace } : {}), method: "POST" }, inputs: inputs.map((input) => normalizeInput(input)), ...(Array.isArray(parameters) ? { parameters: parameters.map(normalizeParameter) } : {}), ...(enableCondition ? { enableCondition: normalizeEnableCondition(enableCondition) } : {}), code: record.code };
}

function normalizeEnableCondition(value: unknown): EnableCondition {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).all)) throw new ValidationError("UseCase enableCondition must contain an all array");
  const all = (value as { all: unknown[] }).all.map((clause) => { if (!clause || typeof clause !== "object" || Array.isArray(clause) || typeof (clause as Record<string, unknown>).field !== "string") throw new ValidationError("UseCase enableCondition clauses require field"); const item = clause as Record<string, unknown>; return { field: String(item.field), ...(Object.hasOwn(item, "equals") ? { equals: item.equals } : {}), ...(typeof item.empty === "boolean" ? { empty: item.empty } : {}) }; });
  return { all };
}

export function matchesEnableCondition(record: EntityRecord, condition?: EnableCondition): boolean {
  return !condition?.all || condition.all.every((clause) => (clause.equals === undefined || record[clause.field] === clause.equals) && (clause.empty === undefined || (clause.empty ? record[clause.field] === undefined || record[clause.field] === null || record[clause.field] === "" : record[clause.field] !== undefined && record[clause.field] !== null && record[clause.field] !== "")));
}

function normalizeParameter(value: unknown): UseCaseParameter {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).name !== "string") throw new ValidationError("UseCase parameters require a name");
  const parameter = value as Record<string, unknown>;
  return { name: String(parameter.name), ...(typeof parameter.type === "string" ? { type: parameter.type as UseCaseParameter["type"] } : {}), ...(typeof parameter.control === "string" ? { control: parameter.control as UseCaseParameter["control"] } : {}), ...(typeof parameter.required === "boolean" ? { required: parameter.required } : {}), ...(Object.hasOwn(parameter, "default") ? { default: parameter.default } : {}) };
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

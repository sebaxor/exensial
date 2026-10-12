import type { EntityOperationContext, EntityOperationMiddleware } from "./entity-runtime";
import { ValidationError } from "./entity-runtime";
import type { CrudAction } from "../domain/request";

type LogicDefinition = Partial<Record<CrudAction, OperationDefinition>>;
type OperationDefinition = { before?: Rule[]; after?: Rule[]; onError?: Rule[] };
type Rule = Record<string, unknown>;
type RuleState = { lookups: Map<string, Record<string, unknown>>; compensations: Array<() => Promise<void>> };

const actions: CrudAction[] = ["create", "bulkCreate", "list", "get", "replace", "update", "delete"];

/** Compiles high-level business rules received through the entity catalog into operation middleware. */
export function compileRuntimeLogic(value: unknown): Partial<Record<CrudAction, EntityOperationMiddleware>> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new ValidationError("logic must be an object keyed by CRUD operation");
  const compiled: Partial<Record<CrudAction, EntityOperationMiddleware>> = {};
  for (const [action, definition] of Object.entries(value)) {
    if (!actions.includes(action as CrudAction)) throw new ValidationError(`Unsupported logic operation: ${action}`);
    const operation = operationDefinition(definition, action);
    compiled[action as CrudAction] = operationMiddleware(operation);
  }
  if (value.create !== undefined && value.bulkCreate === undefined) {
    compiled.bulkCreate = bulkCreateMiddleware(operationDefinition(value.create, "create"));
  }
  return compiled;
}

function operationMiddleware(operation: Required<OperationDefinition>): EntityOperationMiddleware {
  return async (context, next) => {
    const state: RuleState = { lookups: new Map(), compensations: [] };
    await runRules(operation.before, context, state);
    try {
      await next();
    } catch (error) {
      await compensate(operation, context, state);
      throw error;
    }
    await runRules(operation.after, context, state);
  };
}

function bulkCreateMiddleware(operation: Required<OperationDefinition>): EntityOperationMiddleware {
  return async (context, next) => {
    if (!Array.isArray(context.input)) throw new ValidationError("Bulk logic requires an array input");
    const prepared = context.input.map((input) => ({ context: { ...context, input }, state: { lookups: new Map(), compensations: [] } }));
    for (const item of prepared) await runRules(operation.before, item.context, item.state);
    try {
      await next();
    } catch (error) {
      for (const item of prepared.reverse()) await compensate(operation, item.context, item.state);
      throw error;
    }
    for (const item of prepared) await runRules(operation.after, item.context, item.state);
  };
}

async function compensate(operation: Required<OperationDefinition>, context: EntityOperationContext, state: RuleState): Promise<void> {
  await runRules(operation.onError, context, state);
  for (const compensate of state.compensations.reverse()) await compensate();
}

function operationDefinition(value: unknown, action: string): Required<OperationDefinition> {
  if (!isObject(value)) throw new ValidationError(`logic.${action} must be an object`);
  return {
    before: ruleList(value.before, `logic.${action}.before`),
    after: ruleList(value.after, `logic.${action}.after`),
    onError: ruleList(value.onError, `logic.${action}.onError`)
  };
}

function ruleList(value: unknown, location: string): Rule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isObject)) throw new ValidationError(`${location} must be an array of rule objects`);
  return value;
}

async function runRules(rules: Rule[], context: EntityOperationContext, state: RuleState): Promise<void> {
  for (const rule of rules) await runRule(rule, context, state);
}

async function runRule(rule: Rule, context: EntityOperationContext, state: RuleState): Promise<void> {
  const type = requiredString(rule.type, "rule.type");
  if (type === "assert") return assertRule(rule, context, state);
  if (type === "assertDateOrder") return assertDateOrderRule(rule, context, state);
  if (type === "lookup") return lookupRule(rule, context, state);
  if (type === "set") return setRule(rule, context);
  if (type === "copy") return copyRule(rule, context);
  if (type === "normalize") return normalizeRule(rule, context);
  if (type === "validate") return validateRule(rule, context);
  if (type === "transition") return transitionRule(rule, context);
  if (type === "reserve") return reserveRule(rule, context, state);
  if (type === "release") return releaseRule(rule, context);
  if (type === "patch") return patchRule(rule, context, state);
  if (type === "reject") throw new ValidationError(requiredString(rule.message, "rule.message"));
  throw new ValidationError(`Unsupported logic rule: ${type}`);
}

function assertRule(rule: Rule, context: EntityOperationContext, state: RuleState): void {
  const field = requiredString(rule.field, "assert.field");
  const value = sourceRecord(rule.source, context, state)[field];
  const ruleName = requiredString(rule.rule, "assert.rule");
  const message = optionalString(rule.message) ?? `Validation failed for ${field}`;
  if (ruleName === "nonEmptyString" && (typeof value !== "string" || !value.trim())) throw new ValidationError(message);
  if (ruleName === "isoDate" && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) throw new ValidationError(message);
  if (ruleName === "equals" && value !== rule.value) throw new ValidationError(message);
  if (ruleName === "notEquals" && value === rule.value) throw new ValidationError(message);
  if (!["nonEmptyString", "isoDate", "equals", "notEquals"].includes(ruleName)) throw new ValidationError(`Unsupported assert rule: ${ruleName}`);
}

function assertDateOrderRule(rule: Rule, context: EntityOperationContext, state: RuleState): void {
  const source = sourceRecord(rule.source, context, state);
  const earlier = requiredString(rule.earlier, "assertDateOrder.earlier");
  const later = requiredString(rule.later, "assertDateOrder.later");
  if (new Date(String(source[later])).getTime() <= new Date(String(source[earlier])).getTime()) {
    throw new ValidationError(optionalString(rule.message) ?? `${later} must be after ${earlier}`);
  }
}

function lookupRule(rule: Rule, context: EntityOperationContext, state: RuleState): void {
  const as = requiredString(rule.as, "lookup.as");
  const entityName = requiredString(rule.entityName, "lookup.entityName");
  const id = sourceRecord(rule.idSource, context, state)[requiredString(rule.idField, "lookup.idField")];
  if (typeof id !== "string" || !id) throw new ValidationError(optionalString(rule.message) ?? "Referenced id is required");
  const record = context.runtime.findRecord(entityName, id, optionalString(rule.namespace));
  if (!record) throw new ValidationError(optionalString(rule.message) ?? "Referenced record does not exist");
  state.lookups.set(as, record);
}

function setRule(rule: Rule, context: EntityOperationContext): void {
  const input = context.input;
  if (!input || Array.isArray(input)) throw new ValidationError("set rules require a single create or update input");
  input[requiredString(rule.field, "set.field")] = rule.value;
}

function copyRule(rule: Rule, context: EntityOperationContext): void {
  const input = inputRecord(context);
  input[requiredString(rule.to, "copy.to")] = input[requiredString(rule.from, "copy.from")];
}

function normalizeRule(rule: Rule, context: EntityOperationContext): void {
  const mode = optionalString(rule.mode) ?? "trim";
  const fields = stringList(rule.fields, "normalize.fields");
  const input = inputRecord(context);
  for (const field of fields) {
    if (!(field in input)) continue;
    if (typeof input[field] !== "string") throw new ValidationError(`${field} must be a string to normalize`);
    input[field] = mode === "trim" ? input[field].trim() : mode === "lower" ? input[field].trim().toLowerCase() : mode === "upper" ? input[field].trim().toUpperCase() : unsupportedNormalization(mode);
  }
}

function validateRule(rule: Rule, context: EntityOperationContext): void {
  const input = inputRecord(context);
  for (const field of optionalStringList(rule.required, "validate.required")) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new ValidationError(`${field} is required`);
  }
  for (const field of optionalStringList(rule.positiveIntegers, "validate.positiveIntegers")) {
    if (field in input && (!Number.isInteger(input[field]) || Number(input[field]) < 1)) throw new ValidationError(`${field} must be a positive integer`);
  }
  for (const field of optionalStringList(rule.isoDates, "validate.isoDates")) {
    if (field in input && (typeof input[field] !== "string" || !Number.isFinite(Date.parse(input[field])))) throw new ValidationError(`${field} must be an ISO-8601 date-time`);
  }
  if (rule.dateOrder !== undefined) {
    if (!isObject(rule.dateOrder)) throw new ValidationError("validate.dateOrder must be an object");
    const earlier = requiredString(rule.dateOrder.earlier, "validate.dateOrder.earlier");
    const later = requiredString(rule.dateOrder.later, "validate.dateOrder.later");
    if (new Date(String(input[later])).getTime() <= new Date(String(input[earlier])).getTime()) throw new ValidationError(`${later} must be after ${earlier}`);
  }
}

function transitionRule(rule: Rule, context: EntityOperationContext): void {
  const input = inputRecord(context);
  const current = context.current;
  if (!current) throw new ValidationError("transition rules require the current record");
  const field = requiredString(rule.field, "transition.field");
  const from = rule.from;
  const to = rule.to;
  if (current[field] !== from || input[field] !== to) throw new ValidationError(optionalString(rule.message) ?? `Invalid ${field} transition`);
  for (const required of optionalStringList(rule.required, "transition.required")) {
    if (typeof input[required] !== "string" || !input[required].trim()) throw new ValidationError(`${required} is required`);
  }
  for (const fieldName of optionalStringList(rule.isoDates, "transition.isoDates")) {
    if (typeof input[fieldName] !== "string" || !Number.isFinite(Date.parse(input[fieldName]))) throw new ValidationError(`${fieldName} must be an ISO-8601 date-time`);
  }
}

async function reserveRule(rule: Rule, context: EntityOperationContext, state: RuleState): Promise<void> {
  const resource = resourceRule(rule, context, "reserve");
  const amount = positiveAmount(rule.amount);
  const available = resource.record[resource.field];
  if (!Number.isInteger(available) || Number(available) < amount) throw new ValidationError(optionalString(rule.message) ?? "Referenced resource has no available copies");
  await patchResource(context, resource, Number(available) - amount);
  state.compensations.push(() => patchResource(context, resource, Number(available)));
}

async function releaseRule(rule: Rule, context: EntityOperationContext): Promise<void> {
  const resource = resourceRule(rule, context, "release");
  const amount = positiveAmount(rule.amount);
  const available = resource.record[resource.field];
  if (!Number.isInteger(available)) throw new ValidationError(`${resource.field} must be an integer`);
  const next = Number(available) + amount;
  const capacityField = optionalString(rule.capacityField);
  if (capacityField && (!Number.isInteger(resource.record[capacityField]) || next > Number(resource.record[capacityField]))) {
    throw new ValidationError(`${resource.field} cannot exceed ${capacityField}`);
  }
  await patchResource(context, resource, next);
}

async function patchRule(rule: Rule, context: EntityOperationContext, state: RuleState): Promise<void> {
  const entityName = requiredString(rule.entityName, "patch.entityName");
  const id = sourceRecord(rule.idSource, context, state)[requiredString(rule.idField, "patch.idField")];
  if (typeof id !== "string" || !id) throw new ValidationError("Patch target id is required");
  if (!isObject(rule.value)) throw new ValidationError("patch.value must be an object");
  await context.runtime.execute({
    apiVersion: context.request.apiVersion,
    namespace: optionalString(rule.namespace),
    entityName,
    action: "update",
    id,
    payload: { kind: "one", value: rule.value }
  });
}

function resourceRule(
  rule: Rule,
  context: EntityOperationContext,
  name: string
): { entityName: string; namespace?: string; id: string; field: string; record: Record<string, unknown> & { id: string } } {
  const entityName = requiredString(rule.entityName, `${name}.entityName`);
  const field = requiredString(rule.field, `${name}.field`);
  const id = sourceRecord(rule.idSource, context, { lookups: new Map(), compensations: [] })[requiredString(rule.idField, `${name}.idField`)];
  if (typeof id !== "string" || !id) throw new ValidationError(`${name} target id is required`);
  const record = context.runtime.findRecord(entityName, id, optionalString(rule.namespace));
  if (!record) throw new ValidationError(`${name} target does not exist`);
  return { entityName, namespace: optionalString(rule.namespace), id, field, record };
}

async function patchResource(
  context: EntityOperationContext,
  resource: { entityName: string; namespace?: string; id: string; field: string },
  value: number
): Promise<void> {
  await context.runtime.execute({
    apiVersion: context.request.apiVersion,
    namespace: resource.namespace,
    entityName: resource.entityName,
    action: "update",
    id: resource.id,
    payload: { kind: "one", value: { [resource.field]: value } }
  });
}

function inputRecord(context: EntityOperationContext): Record<string, unknown> {
  if (!context.input || Array.isArray(context.input)) throw new ValidationError("Rule requires a single create or update input");
  return context.input;
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new ValidationError(`${name} must be an array of non-empty strings`);
  return value;
}

function optionalStringList(value: unknown, name: string): string[] {
  return value === undefined ? [] : stringList(value, name);
}

function positiveAmount(value: unknown): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || Number(value) < 1) throw new ValidationError("amount must be a positive integer");
  return Number(value);
}

function unsupportedNormalization(mode: string): never {
  throw new ValidationError(`Unsupported normalization mode: ${mode}`);
}

function sourceRecord(source: unknown, context: EntityOperationContext, state: RuleState): Record<string, unknown> {
  const name = optionalString(source) ?? "input";
  if (name === "input") {
    if (!context.input || Array.isArray(context.input)) throw new ValidationError("Rule requires a single input object");
    return context.input;
  }
  if (name === "current") {
    if (!context.current) throw new ValidationError("Rule requires the current record");
    return context.current;
  }
  const lookup = state.lookups.get(name);
  if (!lookup) throw new ValidationError(`Unknown logic lookup: ${name}`);
  return lookup;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${name} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, "string value");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

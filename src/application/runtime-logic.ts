import type { EntityOperationContext, EntityOperationMiddleware } from "./entity-runtime";
import { ValidationError } from "./entity-runtime";
import type { CrudAction } from "../domain/request";

type LogicDefinition = Partial<Record<CrudAction, OperationDefinition>>;
type OperationDefinition = { before?: Rule[]; after?: Rule[]; onError?: Rule[] };
type Rule = Record<string, unknown>;
type RuleState = { lookups: Map<string, Record<string, unknown>> };

const actions: CrudAction[] = ["create", "bulkCreate", "list", "get", "replace", "update", "delete"];

/** Compiles high-level business rules received through the entity catalog into operation middleware. */
export function compileRuntimeLogic(value: unknown): Partial<Record<CrudAction, EntityOperationMiddleware>> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new ValidationError("logic must be an object keyed by CRUD operation");
  const compiled: Partial<Record<CrudAction, EntityOperationMiddleware>> = {};
  for (const [action, definition] of Object.entries(value)) {
    if (!actions.includes(action as CrudAction)) throw new ValidationError(`Unsupported logic operation: ${action}`);
    const operation = operationDefinition(definition, action);
    compiled[action as CrudAction] = async (context, next) => {
      const state: RuleState = { lookups: new Map() };
      await runRules(operation.before, context, state);
      try {
        await next();
      } catch (error) {
        await runRules(operation.onError, context, state);
        throw error;
      }
      await runRules(operation.after, context, state);
    };
  }
  return compiled;
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

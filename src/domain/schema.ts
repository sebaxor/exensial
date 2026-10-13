import type { Documentation, FieldDefinition, FieldUi, LocalizedText, ScalarType, UiControl } from "./entity";

/** Parses the deliberately small TypeScript type-alias subset supported by Exensial. */
export function parseEntitySource(source: string): { typeName: string; fields: Record<string, FieldDefinition>; documentation?: Documentation } {
  const match = source.match(/^\s*(?:\/\*\*([\s\S]*?)\*\/\s*)?type\s+(\w+)\s*=\s*\{([\s\S]*)\}\s*;?\s*$/);
  if (!match) throw new ValidationError("Expected a TypeScript type alias, e.g. type Task = { title: string }");
  const [, entityComment, typeName, body] = match;

  const fields: Record<string, FieldDefinition> = {};
  const fieldPattern = /(?:\/\*\*([\s\S]*?)\*\/\s*)?(\w+)(\?)?\s*:\s*(\w+)\s*[;,]?/g;
  let cursor = 0;
  for (const fieldMatch of body.matchAll(fieldPattern)) {
    const [declaration, fieldComment, name, optional, type] = fieldMatch;
    const skipped = body.slice(cursor, fieldMatch.index).trim();
    if (skipped) throw new ValidationError(`Unsupported field declaration: ${skipped}`);
    const ui = parseUi(fieldComment);
    const scalar = ["string", "number", "boolean", "json"].includes(type);
    if (!scalar && !ui?.relation) throw new ValidationError(`Reference field ${name} needs @exensial.relation`);
    fields[name] = {
      type: scalar ? type as ScalarType : "string",
      required: !optional,
      documentation: parseDocumentation(fieldComment),
      ui
    };
    cursor = (fieldMatch.index ?? 0) + declaration.length;
  }
  const trailing = body.slice(cursor).trim();
  if (trailing) throw new ValidationError(`Unsupported field declaration: ${trailing}`);
  if (!Object.keys(fields).length) throw new ValidationError("An entity needs at least one field");
  return { typeName, fields, documentation: parseDocumentation(entityComment) };
}

export function validateRecord(
  payload: unknown,
  fields: Record<string, FieldDefinition>,
  partial = false
): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Expected a JSON object");
  }
  const record = payload as Record<string, unknown>;
  for (const [name, value] of Object.entries(record)) {
    const field = fields[name];
    if (!field) throw new ValidationError(`Unknown field "${name}".`);
    if (!hasExpectedType(value, field.type)) throw new ValidationError(`Invalid value for field "${name}": expected ${field.type}.`);
  }
  if (!partial) {
    for (const [name, field] of Object.entries(fields)) {
      if (field.required && !(name in record)) throw new ValidationError(`Missing required field "${name}".`);
    }
  }
  return record;
}

function hasExpectedType(value: unknown, type: ScalarType): boolean {
  if (type === "json") return value === null || ["string", "number", "boolean", "object"].includes(typeof value);
  return typeof value === type;
}

/** Extracts localized JSDoc tags: `@exensial.title es Título` and `@exensial.description en Text`. */
function parseDocumentation(comment?: string): Documentation | undefined {
  if (!comment) return undefined;
  const documentation: Documentation = {};
  for (const line of comment.split("\n")) {
    const content = line.replace(/^\s*\*?\s*/, "");
    const operation = content.match(/^@exensial\.operation\s+(\w+)\s+([\w-]+)\s+(.+)$/);
    if (operation) {
      const [, action, locale, text] = operation;
      documentation.operations ??= {};
      documentation.operations[action] ??= {};
      documentation.operations[action][locale] = text.trim();
      continue;
    }
    const tag = content.match(/^@exensial\.(title|description)\s+([\w-]+)\s+(.+)$/);
    if (!tag) continue;
    const [, property, locale, text] = tag;
    const key = property as keyof Documentation;
    documentation[key] ??= {};
    (documentation[key] as LocalizedText)[locale] = text.trim();
  }
  return Object.keys(documentation).length ? documentation : undefined;
}

/** Extracts UI hints from JSDoc without making the schema depend on the HTML console. */
function parseUi(comment?: string): FieldUi | undefined {
  if (!comment) return undefined;
  const lines = comment.split("\n").map((line) => line.replace(/^\s*\*?\s*/, "").trim());
  const ui: FieldUi = {};
  if (lines.some((line) => line === "@exensial.ui.hidden")) ui.hidden = true;
  if (lines.some((line) => line === "@exensial.ui.tableHidden")) ui.tableHidden = true;
  if (lines.some((line) => line === "@exensial.ui.searchable")) ui.searchable = true;
  if (lines.some((line) => line === "@exensial.ui.filterable")) ui.filterable = true;
  const control = lines.map((line) => line.match(/^@exensial\.ui\.control\s+(\w+)$/)).find(Boolean)?.[1];
  if (control) {
    const allowed: UiControl[] = ["text", "textarea", "email", "password", "date", "datetime", "number", "money", "checkbox"];
    if (!allowed.includes(control as UiControl)) throw new ValidationError(`Unsupported UI control: ${control}`);
    ui.control = control as UiControl;
  }
  const relation = lines.map((line) => line.match(/^@exensial\.relation\s+([\w.-]+)(?:\/([\w-]+))?(?:\s+label=(\w+))?$/)).find(Boolean);
  if (relation) {
    const [, first, second, label] = relation;
    ui.relation = second ? { namespace: first, entity: second, ...(label ? { label } : {}) } : { entity: first, ...(label ? { label } : {}) };
  }
  return Object.keys(ui).length ? ui : undefined;
}

export class ValidationError extends Error {}

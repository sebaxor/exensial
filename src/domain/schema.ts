import type { Documentation, FieldDefinition, ScalarType } from "./entity";

/** Parses the deliberately small TypeScript type-alias subset supported by ZFC. */
export function parseEntitySource(source: string): { typeName: string; fields: Record<string, FieldDefinition>; documentation?: Documentation } {
  const match = source.match(/^\s*(?:\/\*\*([\s\S]*?)\*\/\s*)?type\s+(\w+)\s*=\s*\{([\s\S]*)\}\s*;?\s*$/);
  if (!match) throw new ValidationError("Expected a TypeScript type alias, e.g. type Task = { title: string }");
  const [, entityComment, typeName, body] = match;

  const fields: Record<string, FieldDefinition> = {};
  const fieldPattern = /(?:\/\*\*([\s\S]*?)\*\/\s*)?(\w+)(\?)?\s*:\s*(string|number|boolean|json)\s*[;,]?/g;
  let cursor = 0;
  for (const fieldMatch of body.matchAll(fieldPattern)) {
    const [declaration, fieldComment, name, optional, type] = fieldMatch;
    const skipped = body.slice(cursor, fieldMatch.index).trim();
    if (skipped) throw new ValidationError(`Unsupported field declaration: ${skipped}`);
    fields[name] = {
      type: type as ScalarType,
      required: !optional,
      documentation: parseDocumentation(fieldComment)
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
    if (!field) throw new ValidationError(`Unknown field: ${name}`);
    if (!hasExpectedType(value, field.type)) throw new ValidationError(`Field ${name} must be ${field.type}`);
  }
  if (!partial) {
    for (const [name, field] of Object.entries(fields)) {
      if (field.required && !(name in record)) throw new ValidationError(`Missing required field: ${name}`);
    }
  }
  return record;
}

function hasExpectedType(value: unknown, type: ScalarType): boolean {
  if (type === "json") return value === null || ["string", "number", "boolean", "object"].includes(typeof value);
  return typeof value === type;
}

/** Extracts localized JSDoc tags: `@zfc.title es Título` and `@zfc.description en Text`. */
function parseDocumentation(comment?: string): Documentation | undefined {
  if (!comment) return undefined;
  const documentation: Documentation = {};
  for (const line of comment.split("\n")) {
    const tag = line.replace(/^\s*\*?\s*/, "").match(/^@zfc\.(title|description)\s+([\w-]+)\s+(.+)$/);
    if (!tag) continue;
    const [, property, locale, text] = tag;
    const key = property as keyof Documentation;
    documentation[key] ??= {};
    documentation[key]![locale] = text.trim();
  }
  return Object.keys(documentation).length ? documentation : undefined;
}

export class ValidationError extends Error {}

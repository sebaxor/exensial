import type { FieldDefinition, ScalarType } from "./entity";

/** Parses the deliberately small TypeScript type-alias subset supported by ZFC. */
export function parseTypeDefinition(source: string): Record<string, FieldDefinition> {
  const body = source.match(/^\s*type\s+\w+\s*=\s*\{([\s\S]*)\}\s*;?\s*$/)?.[1];
  if (!body) throw new ValidationError("Expected a TypeScript type alias, e.g. type Book = { title: string }");

  const fields: Record<string, FieldDefinition> = {};
  for (const declaration of body.split(/[;,\n]/).map((part) => part.trim()).filter(Boolean)) {
    const match = declaration.match(/^(\w+)(\?)?\s*:\s*(string|number|boolean)$/);
    if (!match) throw new ValidationError(`Unsupported field declaration: ${declaration}`);
    fields[match[1]] = { type: match[3] as ScalarType, required: !match[2] };
  }
  if (!Object.keys(fields).length) throw new ValidationError("An entity needs at least one field");
  return fields;
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
    if (typeof value !== field.type) throw new ValidationError(`Field ${name} must be ${field.type}`);
  }
  if (!partial) {
    for (const [name, field] of Object.entries(fields)) {
      if (field.required && !(name in record)) throw new ValidationError(`Missing required field: ${name}`);
    }
  }
  return record;
}

export class ValidationError extends Error {}

import type { EntityDefinition, EntityRecord, FieldDefinition } from "../domain/entity";
import { ValidationError } from "../domain/schema";

/**
 * Small, deliberately safe OData-like filter compiler. It turns a public query
 * string into a predicate; it never evaluates submitted JavaScript or SQL.
 */
export function compileExensialFilter(filter: string | null, definition: EntityDefinition): (record: EntityRecord) => boolean {
  if (!filter?.trim()) return () => true;
  const clauses = filter.trim().split(/\s+and\s+/i).map((clause) => clause.split(/\s+or\s+/i).map((part) => compileClause(part.trim(), definition)));
  return (record) => clauses.every((alternatives) => alternatives.some((clause) => clause(record)));
}

function compileClause(source: string, definition: EntityDefinition): (record: EntityRecord) => boolean {
  const functionMatch = source.match(/^(contains|startswith|endswith)\((\w+),\s*'((?:[^']|'')*)'\)$/i);
  if (functionMatch) {
    const [, operation, fieldName, rawValue] = functionMatch;
    const field = queryableField(fieldName, definition, true);
    if (field.type !== "string") throw new ValidationError(`${fieldName} does not support text search`);
    const value = rawValue.replace(/''/g, "'").toLocaleLowerCase();
    return (record) => {
      const text = String(record[fieldName] ?? "").toLocaleLowerCase();
      return operation.toLowerCase() === "contains" ? text.includes(value) : operation.toLowerCase() === "startswith" ? text.startsWith(value) : text.endsWith(value);
    };
  }
  const comparison = source.match(/^(\w+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
  if (!comparison) throw new ValidationError("Unsupported $filter. Use contains(field, 'text') or field eq value; join clauses with and.");
  const [, fieldName, operator, literal] = comparison;
  const field = queryableField(fieldName, definition, false);
  const expected = parseLiteral(literal, field);
  return (record) => compare(record[fieldName], expected, operator.toLowerCase());
}

function queryableField(name: string, definition: EntityDefinition, text: boolean): FieldDefinition {
  const field = definition.fields[name];
  if (!field) throw new ValidationError(`Unknown filter field: ${name}`);
  if (text ? !field.ui?.searchable : !(field.ui?.searchable || field.ui?.filterable)) throw new ValidationError(`Field is not ${text ? "searchable" : "filterable"}: ${name}`);
  return field;
}

function parseLiteral(literal: string, field: FieldDefinition): string | number | boolean {
  const quoted = literal.match(/^'((?:[^']|'')*)'$/);
  if (field.type === "string") {
    if (!quoted) throw new ValidationError("String filter values must use single quotes");
    return quoted[1].replace(/''/g, "'");
  }
  if (field.type === "boolean" && /^(true|false)$/i.test(literal)) return literal.toLowerCase() === "true";
  if (field.type === "number" && Number.isFinite(Number(literal))) return Number(literal);
  throw new ValidationError(`Invalid filter value for ${field.type} field`);
}

function compare(actual: unknown, expected: string | number | boolean, operator: string): boolean {
  if (operator === "eq") return actual === expected;
  if (operator === "ne") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "gt") return actual > expected;
  if (operator === "ge") return actual >= expected;
  if (operator === "lt") return actual < expected;
  return actual <= expected;
}

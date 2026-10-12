import type { EntityDefinition, FieldDefinition, LocalizedText, ScalarType } from "./domain/entity";

type Schema = Record<string, unknown>;

/** Builds an OpenAPI document from the entities that are installed right now. */
export function createOpenApi(definitions: EntityDefinition[]): Record<string, unknown> {
  const schemas = Object.fromEntries(definitions.map((definition) => [definition.name, entitySchema(definition)]));
  const paths = Object.assign({}, ...definitions.map((definition) => entityPaths(definition)));
  return {
    openapi: "3.0.4",
    info: { title: "ZFC Dynamic API", version: "1.0.0", description: "Runtime-defined entities exposed through REST." },
    paths,
    components: { schemas }
  };
}

function entitySchema(definition: EntityDefinition): Schema {
  const properties = Object.fromEntries([
    ["id", { type: "string", format: "uuid", readOnly: true }],
    ...Object.entries(definition.fields).map(([name, field]) => [name, fieldSchema(field)])
  ]);
  return {
    type: "object",
    title: text(definition.documentation?.title) ?? definition.name,
    description: text(definition.documentation?.description),
    "x-zfc-localized": definition.documentation,
    "x-exensial-context": definition.context,
    properties,
    required: ["id", ...Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name)]
  };
}

function fieldSchema(field: FieldDefinition): Schema {
  return {
    ...scalarSchema(field.type),
    title: text(field.documentation?.title),
    description: text(field.documentation?.description),
    "x-zfc-localized": field.documentation
  };
}

function scalarSchema(type: ScalarType): Schema {
  if (type === "json") return {};
  return { type };
}

function entityPaths(definition: EntityDefinition): Record<string, unknown> {
  const reference = { $ref: `#/components/schemas/${definition.name}` };
  const collectionPath = `/v1/${definition.name}`;
  const itemPath = `${collectionPath}/{id}`;
  return {
    [collectionPath]: {
      get: operation(`List ${definition.name}`, definition, { 200: { description: "Collection", content: jsonContent({ type: "array", items: reference }) } }),
      post: operation(`Create or import ${definition.name}`, definition, {
        201: { description: "Created", content: jsonContent({ oneOf: [reference, { type: "object", properties: { items: { type: "array", items: reference } }, required: ["items"] }] }) }
      }, { oneOf: [reference, { type: "array", items: reference }] })
    },
    [itemPath]: {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: operation(`Get ${definition.name}`, definition, { 200: { description: "Record", content: jsonContent(reference) }, 404: errorResponse() }),
      put: operation(`Replace ${definition.name}`, definition, { 200: { description: "Replaced", content: jsonContent(reference) }, 404: errorResponse() }, reference),
      patch: operation(`Update ${definition.name}`, definition, { 200: { description: "Updated", content: jsonContent(reference) }, 404: errorResponse() }, reference),
      delete: operation(`Delete ${definition.name}`, definition, { 204: { description: "Deleted" }, 404: errorResponse() })
    }
  };
}

function operation(summary: string, definition: EntityDefinition, responses: Record<string | number, unknown>, requestSchema?: Schema): Schema {
  return {
    tags: [definition.name],
    summary,
    description: text(definition.documentation?.description),
    ...(requestSchema ? { requestBody: { required: true, content: jsonContent(requestSchema) } } : {}),
    responses
  };
}

function jsonContent(schema: Schema): Schema { return { "application/json": { schema } }; }
function errorResponse(): Schema { return { description: "Not found", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }) }; }
function text(localized?: LocalizedText): string | undefined { return localized?.en ?? Object.values(localized ?? {})[0]; }

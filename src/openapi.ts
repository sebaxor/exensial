import type { EntityDefinition, FieldDefinition, LocalizedText, ScalarType } from "./domain/entity";
import { localizedValue, type LocalizationEntry } from "./application/localization";
import { routeForUseCase, type UseCaseDefinition } from "./application/use-cases";

type Schema = Record<string, unknown>;

/** Builds an OpenAPI document from the entities that are installed right now. */
export interface OpenApiOptions { exensialQuery?: boolean; security?: boolean; views?: boolean; useCases?: UseCaseDefinition[]; permissions?: Array<Record<string, unknown>>; roles?: Array<Record<string, unknown>>; language?: string; localizations?: LocalizationEntry[]; }

export function createOpenApi(definitions: EntityDefinition[], capabilities: OpenApiOptions = {}): Record<string, unknown> {
  const language = capabilities.language ?? "en";
  const localizations = capabilities.localizations ?? [];
  const schemas = Object.fromEntries(definitions.map((definition) => [schemaKey(definition), entitySchema(definition, language, localizations)]));
  const paths = Object.assign({}, ...(capabilities.security ? [authenticationPaths(language, localizations)] : []), ...(capabilities.views ? [viewPaths(language)] : []), useCasePaths(capabilities.useCases ?? [], language), ...definitions.map((definition) => ({ ...entityPaths(definition, language, localizations), ...(capabilities.exensialQuery ? exensialQueryPaths(definition, language, localizations) : {}) })));
  if (capabilities.security) applyAuthorizationMetadata(paths, capabilities.permissions ?? [], capabilities.roles ?? []);
  return {
    openapi: "3.0.4",
    info: {
      title: localizedValue(localizations, language, "openapi.info.title") ?? "Exensial API",
      version: highestEntityVersion(definitions),
      description: localizedValue(localizations, language, "openapi.info.description") ?? entityCatalogGuide(language)
    },
    "x-exensial-language": language,
    "x-exensial-locales": [...new Set(["en", ...localizations.map((entry) => entry.locale)])].sort(),
    "x-exensial-ui-localization": Object.fromEntries(localizations.filter((entry) => entry.locale === language && entry.key.startsWith("ui.")).map((entry) => [entry.key, entry.value])),
    "x-exensial-capabilities": {
      ...(capabilities.security ? { security: { loginPath: "/v1/auth/login", scheme: "bearerAuth", description: "Operations with x-exensial-authorization require a matching JWT role." } } : {}),
      ...(capabilities.views ? { views: { catalogPath: "/v1/views", menuCatalogPath: "/v1/menus", manifestPath: "/v1/views/manifest", dataPathTemplate: "/v1/views/{viewId}/data" } } : {}),
      ...(capabilities.useCases ? { useCases: { catalogPath: "/v1/useCases", execution: "POST routes declared by each use case" } } : {}),
      ...(capabilities.exensialQuery ? { query: { languages: { odata: { root: "/v1/query/odata", legacyRoots: ["/v1/query/exensial"], transport: "GET", description: exensialQueryText(language, localizations, "capability.description", { en: "Optional OData-like read capability. Supports $filter (contains, startswith, endswith, eq, ne, gt, ge, lt, le joined with and), $skip, and $top. Only fields annotated as searchable or filterable can be queried.", es: "Capacidad opcional de lectura similar a OData. Admite $filter (contains, startswith, endswith, eq, ne, gt, ge, lt y le unidos con and), $skip y $top. Solo se pueden consultar campos anotados como buscables o filtrables." }) }, exensialquery: { representation: "exensialquery-ast", transport: "POST", availability: "named-views" } }, exensialQuery: { root: "/v1/query/exensial", deprecated: true } } } : {}) },
    paths,
    components: { schemas, ...(capabilities.security ? { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Obtain a token from POST /v1/auth/login and send it as Authorization: Bearer <token>. Endpoint permissions decide whether authentication is required." } } } : {}) }
  };
}

function useCasePaths(useCases: UseCaseDefinition[], language: string): Record<string, unknown> {
  return Object.fromEntries(useCases.map((useCase) => [routeForUseCase(useCase), { post: {
    tags: [language === "es" ? "Casos de uso" : "Use cases"], operationId: `execute${identifier(useCase.useCaseId)}`, summary: useCase.name,
    description: language === "es" ? "Ejecuta un caso de uso instalado en tiempo de ejecución con listas de IDs de registros." : "Executes a runtime-installed use case with lists of record IDs.",
    "x-exensial-usecase": { useCaseId: useCase.useCaseId, name: useCase.name, icon: useCase.icon, inputs: useCase.inputs },
    requestBody: { required: true, content: jsonContent({ type: "object", required: ["inputs"], properties: { inputs: { type: "object", properties: Object.fromEntries(useCase.inputs.map((input) => [input.name, { type: "array", minItems: input.minItems, maxItems: input.maxItems, items: { type: "string" } }])) } } }, { inputs: Object.fromEntries(useCase.inputs.map((input) => [input.name, ["record-id"]])) }) },
    responses: { 200: { description: language === "es" ? "Caso de uso ejecutado" : "Use case executed", content: jsonContent({ type: "object" }) }, 400: validationErrorResponse(), 404: errorResponse() }
  } }]));
}

function viewPaths(language: string): Record<string, unknown> {
  const text = language === "es" ? { tag: "Vistas", summary: "Ejecutar una vista de consulta", description: "Ejecuta el AST ExensialQuery persistido de una QueryView con parámetros escalares." } : { tag: "Views", summary: "Execute a QueryView", description: "Executes a QueryView's persisted ExensialQuery AST with scalar parameters." };
  return {
    "/v1/views/{viewId}/data": {
      post: {
        tags: [text.tag], operationId: "executeQueryView", summary: text.summary, description: text.description,
        parameters: [{ name: "viewId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: false, content: jsonContent({ type: "object", properties: { parameters: { type: "object", additionalProperties: { nullable: true } } } }, { parameters: {} }) },
        responses: { 200: { description: language === "es" ? "Resultado de la vista" : "View result", content: jsonContent({ type: "object", properties: { viewId: { type: "string" }, items: { type: "array", items: { type: "object" } } } }) }, 400: validationErrorResponse(), 404: errorResponse() }
      }
    }
  };
}

function applyAuthorizationMetadata(paths: Record<string, unknown>, permissions: Array<Record<string, unknown>>, roles: Array<Record<string, unknown>>): void {
  const roleName = (value: unknown) => String(roles.find((role) => role.id === value)?.name ?? value);
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      if (!/^(get|post|put|patch|delete)$/i.test(method) || !operation || typeof operation !== "object") continue;
      const rules = permissions.filter((permission) => (String(permission.method) === "*" || String(permission.method).toUpperCase() === method.toUpperCase()) && matchesPath(String(permission.path), path));
      if (!rules.length) continue;
      const metadata = rules.map(({ role, decision, method: ruleMethod, path: rulePath }) => ({ role: roleName(role), decision, method: ruleMethod, path: rulePath }));
      const anonymous = metadata.some((rule) => rule.role === "anonymous" && rule.decision === "allow");
      Object.assign(operation as Record<string, unknown>, { ...(anonymous ? {} : { security: [{ bearerAuth: [] }] }), "x-exensial-authorization": { required: !anonymous, anonymous, rules: metadata } });
    }
  }
}

function matchesPath(pattern: string, path: string): boolean { return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path; }

function authenticationPaths(language: string, localizations: LocalizationEntry[]): Record<string, unknown> {
  const text = (key: string, fallback: LocalizedText) => localizedValue(localizations, language, `openapi.authentication.${key}`, fallback);
  return {
    "/v1/auth/login": {
      post: {
        tags: [text("tag", { en: "Authentication", es: "Autenticación" })], operationId: "login", summary: text("login.summary", { en: "Create a local JWT session", es: "Crear una sesión JWT local" }), description: text("login.description", { en: "Checks a local Exensial user and returns a short-lived Bearer token. A future identity-provider adapter can populate the same principal context.", es: "Valida un usuario local de Exensial y devuelve un token Bearer de duración limitada. Un adaptador futuro de proveedor de identidad puede proporcionar el mismo contexto de principal." }),
        requestBody: { required: true, content: jsonContent({ type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string", format: "password" } } }, { username: "admin", password: "admin123" }) },
        responses: { 200: { description: text("login.authenticated", { en: "Authenticated", es: "Autenticado" }), content: jsonContent({ type: "object", properties: { accessToken: { type: "string" }, tokenType: { type: "string" }, expiresIn: { type: "integer" } } }, { accessToken: "eyJ...", tokenType: "Bearer", expiresIn: 28800 }) }, 401: { description: text("login.invalidCredentials", { en: "Invalid credentials", es: "Credenciales inválidas" }) } }
      }
    }
  };
}

function exensialQueryPaths(definition: EntityDefinition, language: string, localizations: LocalizationEntry[]): Record<string, unknown> {
  const namespace = definition.context?.namespace;
  const path = `/v1/query/exensial/${namespace ? `${namespace}/` : ""}${definition.name}`;
  const reference = { $ref: `#/components/schemas/${schemaKey(definition)}` };
  return {
    [path]: {
      get: {
        tags: [schemaKey(definition), "ExensialQuery"],
        operationId: `query${identifier(schemaKey(definition))}`,
        summary: operationSummary(definition, "query", language, localizations),
        description: exensialQueryText(language, localizations, "description", { en: "Uses the optional ExensialQuery capability. It is an OData-like, safe read-only subset; only fields annotated with @exensial.ui.searchable or @exensial.ui.filterable may be used in $filter.", es: "Usa la capacidad opcional ExensialQuery. Es un subconjunto seguro y de solo lectura similar a OData; en $filter solo se pueden usar campos anotados con @exensial.ui.searchable o @exensial.ui.filterable." }),
        parameters: [
          { name: "$filter", in: "query", description: exensialQueryText(language, localizations, "filter.description", { en: "Examples: contains(title, 'Dune') or copiesAvailable gt 0. Clauses can be joined with and.", es: "Ejemplos: contains(title, 'Dune') o copiesAvailable gt 0. Las cláusulas se pueden unir con and." }), schema: { type: "string" } },
          { name: "$skip", in: "query", description: exensialQueryText(language, localizations, "skip.description", { en: "Number of matching records to omit. Defaults to 0.", es: "Cantidad de registros coincidentes que se omiten. El valor predeterminado es 0." }), schema: { type: "integer", minimum: 0, default: 0 } },
          { name: "$top", in: "query", description: exensialQueryText(language, localizations, "top.description", { en: "Maximum matching records to return. Defaults to 25; maximum 100.", es: "Máximo de registros coincidentes que se devuelven. El valor predeterminado es 25 y el máximo es 100." }), schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }
        ],
        responses: {
          200: { description: exensialQueryText(language, localizations, "response.matched", { en: "Matching records returned. X-Total-Count is the total before paging.", es: "Se devolvieron los registros coincidentes. X-Total-Count indica el total antes de paginar." }), headers: { "X-Total-Count": { schema: { type: "integer" } }, "X-Query-Skip": { schema: { type: "integer" } }, "X-Query-Top": { schema: { type: "integer" } } }, content: jsonContent({ type: "array", items: reference }) },
          400: validationErrorResponse(),
          404: errorResponse()
        }
      }
    }
  };
}

function exensialQueryText(language: string, localizations: LocalizationEntry[], key: string, fallback: LocalizedText): string {
  return localizedValue(localizations, language, `openapi.exensialQuery.${key}`, fallback) ?? fallback.en;
}

function entitySchema(definition: EntityDefinition, language: string, localizations: LocalizationEntry[]): Schema {
  const key = `entity.${schemaKey(definition)}`;
  const properties = Object.fromEntries([
    ["id", { type: "string", format: "uuid", readOnly: true }],
    ...Object.entries(definition.fields).map(([name, field]) => [name, fieldSchema(field, language, localizations, `${key}.field.${name}`)])
  ]);
  return {
    type: "object",
    title: localizedValue(localizations, language, `${key}.title`, definition.documentation?.title) ?? definition.name,
    description: localizedValue(localizations, language, `${key}.description`, definition.documentation?.description),
    "x-exensial-localized": definition.documentation,
    "x-exensial-context": definition.context,
    properties,
    required: ["id", ...Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name)]
  };
}

function fieldSchema(field: FieldDefinition, language: string, localizations: LocalizationEntry[], key: string): Schema {
  return {
    ...scalarSchema(field.type),
    ...uiFormat(field.ui?.control),
    title: localizedValue(localizations, language, `${key}.title`, field.documentation?.title),
    description: localizedValue(localizations, language, `${key}.description`, field.documentation?.description),
    ...(field.enum ? { enum: field.enum } : {}),
    ...("default" in field ? { default: field.default } : {}),
    "x-exensial-localized": field.documentation,
    "x-exensial-ui": field.ui
  };
}

function uiFormat(control?: string): Schema {
  if (control === "email") return { format: "email" };
  if (control === "date") return { format: "date" };
  if (control === "datetime") return { format: "date-time" };
  return {};
}

function scalarSchema(type: ScalarType): Schema {
  if (type === "json") return {};
  return { type };
}

function entityPaths(definition: EntityDefinition, language: string, localizations: LocalizationEntry[]): Record<string, unknown> {
  const reference = { $ref: `#/components/schemas/${schemaKey(definition)}` };
  const namespace = definition.context?.namespace;
  const collectionPath = `/v1/${namespace ? `${namespace}/` : ""}${definition.name}`;
  const itemPath = `${collectionPath}/{id}`;
  const input = inputExample(definition);
  const record = { id: exampleId(), ...input };
  const bulkInput = [input, inputExample(definition, 2)];
  const partialInput = partialExample(definition);
  return {
    [collectionPath]: {
      get: operation(definition, "list", language, localizations, {
        200: { description: "Collection returned", content: jsonContent({ type: "array", items: reference }, [record]) }
      }),
      post: operation(definition, "create", language, localizations, {
        201: {
          description: "Record or bulk import created",
          content: jsonContent({ oneOf: [reference, { type: "object", properties: { items: { type: "array", items: reference } }, required: ["items"] }] }, record)
        },
        400: validationErrorResponse()
      }, jsonExamples({ oneOf: [reference, { type: "array", items: reference }] }, {
        one: { summary: "Create one record", value: input },
        many: { summary: "Import multiple records", value: bulkInput }
      }))
    },
    [itemPath]: {
      parameters: [{ name: "id", in: "path", required: true, description: "Record identifier returned by a create operation.", schema: { type: "string", format: "uuid" }, example: exampleId() }],
      get: operation(definition, "get", language, localizations, { 200: { description: "Record returned", content: jsonContent(reference, record) }, 404: errorResponse() }),
      put: operation(definition, "replace", language, localizations, {
        200: { description: "Record replaced", content: jsonContent(reference, record) }, 400: validationErrorResponse(), 404: errorResponse()
      }, jsonContent(reference, input)),
      patch: operation(definition, "update", language, localizations, {
        200: { description: "Record updated", content: jsonContent(reference, { ...record, ...partialInput }) }, 400: validationErrorResponse(), 404: errorResponse()
      }, jsonContent(reference, partialInput)),
      delete: operation(definition, "delete", language, localizations, { 204: { description: "Record deleted" }, 404: errorResponse() })
    }
  };
}

function operation(
  definition: EntityDefinition,
  action: string,
  language: string,
  localizations: LocalizationEntry[],
  responses: Record<string | number, unknown>,
  requestContent?: Schema
): Schema {
  return {
    tags: [schemaKey(definition)],
    operationId: `${action}${identifier(schemaKey(definition))}`,
    summary: operationSummary(definition, action, language, localizations),
    description: [localizedValue(localizations, language, `entity.${schemaKey(definition)}.description`, definition.documentation?.description), operationDetail(action, language)].filter(Boolean).join("\n\n"),
    ...(requestContent ? { requestBody: { required: true, content: requestContent } } : {}),
    responses
  };
}

function operationSummary(definition: EntityDefinition, action: string, language: string, localizations: LocalizationEntry[]): string {
  const key = `entity.${schemaKey(definition)}.operation.${action}.summary`;
  const configured = localizedValue(localizations, language, key, definition.documentation?.operations?.[action]);
  if (configured) return configured;
  const verb = language === "es" ? ({ list: "Listar", create: "Crear o importar", get: "Consultar", replace: "Reemplazar", update: "Actualizar", delete: "Eliminar", query: "Consultar" }[action] ?? action) : ({ list: "List", create: "Create or import", get: "Get", replace: "Replace", update: "Update", delete: "Delete", query: "Query" }[action] ?? action);
  return `${verb} ${definition.name}`;
}

function operationDetail(action: string, language: string): string {
  const spanish: Record<string, string> = { list: "Devuelve todos los registros almacenados actualmente por esta entidad.", create: "Envía un objeto para crear un registro o un arreglo de objetos para importarlos en bloque.", get: "Devuelve un registro por su id.", replace: "Reemplaza un registro. Incluye todos los campos requeridos declarados por la entidad.", update: "Actualiza únicamente los campos enviados; los campos requeridos pueden omitirse.", delete: "Elimina permanentemente un registro por su id." };
  const english: Record<string, string> = { list: "Returns every record currently held by this entity.", create: "Send one object to create one record, or an array of objects to import records in bulk.", get: "Returns one record by id.", replace: "Replaces a record. Include every required field declared by the entity.", update: "Updates only the supplied fields; required fields may be omitted.", delete: "Permanently removes one record by id." };
  return (language === "es" ? spanish : english)[action] ?? "";
}

function jsonContent(schema: Schema, example?: unknown): Schema {
  return { "application/json": { schema, ...(example === undefined ? {} : { example }) } };
}
function jsonExamples(schema: Schema, examples: Record<string, { summary: string; value: unknown }>): Schema {
  return { "application/json": { schema, examples } };
}
function errorResponse(): Schema { return { description: "Record not found", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }, { error: "Record not found" }) }; }
function validationErrorResponse(): Schema { return { description: "Request does not match the entity schema", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }, { error: "Missing required field: title" }) }; }
function text(localized?: LocalizedText): string | undefined { return localized?.en ?? Object.values(localized ?? {})[0]; }
function schemaKey(definition: EntityDefinition): string { return definition.context?.namespace ? `${definition.context.namespace}.${definition.name}` : definition.name; }
function identifier(value: string): string { return value.replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next?: string) => next?.toUpperCase() ?? "").replace(/^./, (first) => first.toUpperCase()); }

function inputExample(definition: EntityDefinition, index = 1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(definition.fields).map(([name, field]) => [name, fieldExample(name, field, index)]));
}

function partialExample(definition: EntityDefinition): Record<string, unknown> {
  const [name, field] = Object.entries(definition.fields)[0] ?? [];
  return name && field ? { [name]: fieldExample(name, field, 2) } : {};
}

function fieldExample(name: string, field: FieldDefinition, index: number): unknown {
  if (field.type === "number") return index === 1 ? 42 : 84;
  if (field.type === "boolean") return index % 2 === 1;
  if (field.type === "json") return { example: true, sequence: index };
  if (name.endsWith("At")) return "2026-10-12T12:00:00.000Z";
  if (name.toLowerCase().includes("email")) return "person@example.com";
  if (name === "apiVersion") return "v1";
  if (name === "action") return "create";
  if (name === "entityName") return "tasks";
  if (name === "namespace") return "acme.work";
  if (name === "definition") return "type Task = { title: string; completed?: boolean }";
  return `Example ${name}${index === 1 ? "" : ` ${index}`}`;
}

function exampleId(): string { return "550e8400-e29b-41d4-a716-446655440000"; }
function highestEntityVersion(definitions: EntityDefinition[]): string {
  return definitions.map((definition) => definition.context?.version ?? "1.0.0").sort((left, right) => {
    const a = left.split(".").map(Number), b = right.split(".").map(Number);
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  })[0] ?? "1.0.0";
}

function entityCatalogGuide(language: string): string {
  if (language === "es") return `## Empieza aquí: define una colección y después crea registros

Una **definición de entidad** describe qué campos JSON acepta una colección. No crea por sí sola un libro, una tarea ni otro registro. Envía la definición a **POST /v1/entities** y luego usa la ruta que Exensial crea para los registros reales.

### 1. Define una entidad

Esto crea una colección de tareas con espacio de nombres. El alias de tipo es una cadena porque es información enviada por HTTP.

\`\`\`json
{
  "name": "tasks",
  "namespace": "acme.work",
  "definition": "type Task = { title: string; completed?: boolean }"
}
\`\`\`

### 2. Crea y consulta registros

Cuando la definición termine correctamente, crea un registro en la ruta de colección generada:

\`\`\`text
POST /v1/acme.work/tasks
{ "title": "Preparar la demostración", "completed": false }

201 Created
{ "id": "<generated-id>", "title": "Preparar la demostración", "completed": false }
\`\`\`

Usa ese \`id\` devuelto con \`GET /v1/acme.work/tasks/{id}\`, \`PATCH /v1/acme.work/tasks/{id}\` o \`DELETE /v1/acme.work/tasks/{id}\`.

### Cómo se elige una ruta

| Definición | Ruta de colección | Ruta de elemento |
| --- | --- | --- |
| \`{ "name": "tasks" }\` | \`/v1/tasks\` | \`/v1/tasks/{id}\` |
| \`{ "name": "tasks", "namespace": "acme.work" }\` | \`/v1/acme.work/tasks\` | \`/v1/acme.work/tasks/{id}\` |

El espacio de nombres es opcional pero, cuando existe, siempre es el segmento inmediatamente posterior a la versión de API. El par espacio de nombres y nombre identifica una entidad, por lo que dos espacios de nombres pueden contener \`tasks\`.

### Comportamiento CRUD

- **GET de colección** lista registros.
- **POST de colección con un objeto** crea un registro.
- **POST de colección con un arreglo** importa varios registros.
- **GET de elemento** consulta un registro por id.
- **PUT de elemento** lo reemplaza y exige todos los campos requeridos.
- **PATCH de elemento** cambia únicamente los campos enviados.
- **DELETE de elemento** lo elimina y devuelve \`204 No Content\`.

Las operaciones de abajo incluyen ejemplos de solicitudes y respuestas generados a partir de los campos actuales de cada entidad. Léelos como la estructura exacta que acepta el esquema activo.

### Documentación y localización

Agrega JSDoc con \`@exensial.title <locale> <text>\` y \`@exensial.description <locale> <text>\` antes del tipo o de un campo. Swagger usa inglés cuando está disponible y conserva todos los idiomas en \`x-exensial-localized\`.

\`\`\`ts
/**
 * @exensial.title en Tasks
 * @exensial.title es Tareas
 * @exensial.description en Work tracked by a team
 */
type Task = {
  /** @exensial.description en A concise task summary */
  title: string;
  completed?: boolean;
}
\`\`\`

### Código de dominio en tiempo de ejecución

Usa el campo opcional \`code\` en la misma solicitud que crea una entidad. Contiene un módulo TypeScript de alto nivel con funciones para las operaciones CRUD. Es código de dominio recibido e instalado por HTTP y opera con el contexto de registros de Exensial, no con objetos HTTP ni repositorios concretos. Consulta la guía de creación de entidades para el contrato completo.`;
  return `## Start here: define a collection, then create records

An **entity definition** describes which JSON fields a collection accepts. It does not create a book, task, or other record by itself. Send the definition to **POST /v1/entities**, then use the route that Exensial creates for the actual records.

### 1. Define an entity

This creates a namespaced task collection. The type alias is a string because it is data sent over HTTP.

\`\`\`json
{
  "name": "tasks",
  "namespace": "acme.work",
  "definition": "type Task = { title: string; completed?: boolean }"
}
\`\`\`

### 2. Create and read records

After the definition succeeds, create a record at the generated collection route:

\`\`\`text
POST /v1/acme.work/tasks
{ "title": "Prepare the demo", "completed": false }

201 Created
{ "id": "<generated-id>", "title": "Prepare the demo", "completed": false }
\`\`\`

Use that returned \`id\` with \`GET /v1/acme.work/tasks/{id}\`, \`PATCH /v1/acme.work/tasks/{id}\`, or \`DELETE /v1/acme.work/tasks/{id}\`.

### How a route is chosen

| Definition | Collection route | Item route |
| --- | --- | --- |
| \`{ "name": "tasks" }\` | \`/v1/tasks\` | \`/v1/tasks/{id}\` |
| \`{ "name": "tasks", "namespace": "acme.work" }\` | \`/v1/acme.work/tasks\` | \`/v1/acme.work/tasks/{id}\` |

The namespace is optional, but when present it is always the segment immediately after the API version. The pair of namespace and name identifies an entity, so two namespaces may both contain \`tasks\`.

### CRUD behavior

- **GET collection** lists records.
- **POST collection with an object** creates one record.
- **POST collection with an array** imports several records.
- **GET item** reads one record by id.
- **PUT item** replaces it and requires every required field.
- **PATCH item** changes only the submitted fields.
- **DELETE item** removes it and returns \`204 No Content\`.

The operations below include generated request and response examples based on each entity's current fields. Read those examples as the exact shape accepted by the active schema.

### Documentation and localization

Add JSDoc with \`@exensial.title <locale> <text>\` and \`@exensial.description <locale> <text>\` before the type or a field. Swagger uses English when available and preserves all locales in \`x-exensial-localized\`.

\`\`\`ts
/**
 * @exensial.title en Tasks
 * @exensial.title es Tareas
 * @exensial.description en Work tracked by a team
 */
type Task = {
  /** @exensial.description en A concise task summary */
  title: string;
  completed?: boolean;
}
\`\`\`

### Runtime domain code

Use the optional \`code\` field in the same request that creates an entity. It contains a high-level TypeScript module with functions for CRUD operations. It is domain code received and installed through HTTP and operates through Exensial's record context, not HTTP objects or concrete repositories. See the entity authoring guide for the complete contract.`;
}

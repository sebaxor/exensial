# Crear entidades en Exensial

## Entidad solo con estructura

Envía un alias TypeScript a `POST /v1/entities`. El nombre se convierte en la ruta:

```json
{
  "name": "tasks",
  "definition": "type Task = { title: string; completed?: boolean }"
}
```

Esto crea inmediatamente `POST/GET /v1/tasks` y `GET/PUT/PATCH/DELETE /v1/tasks/:id`.

Tipos admitidos: `string`, `number`, `boolean`, `json` y campos opcionales con `?`.

## Nombres, descripciones e idiomas

Usa JSDoc dentro de la definición. Los tags son `@zfc.title` y `@zfc.description`, seguidos por locale y texto.

```ts
/**
 * @zfc.title en Tasks
 * @zfc.title es Tareas
 * @zfc.description en Work items for a team
 */
type Task = {
  /**
   * @zfc.title en Title
   * @zfc.title es Título
   * @zfc.description en A concise task summary
   */
  title: string;
  completed?: boolean;
}
```

La información aparece en `/openapi.json`: el título/descripción inglés se usa en campos estándar OpenAPI y todos los idiomas se conservan en `x-zfc-localized`.

## Contexto lógico

`namespace` no cambia la ruta, pero organiza la entidad para clientes y reglas futuras. Usa nombres tipo package con puntos:

```json
{ "name": "tasks", "namespace": "acme.work", "definition": "..." }
```

Se publica como `x-exensial-context` en OpenAPI.

## Comportamiento de negocio

El body HTTP nunca contiene código ejecutable. La aplicación registra módulos confiables y una entidad puede seleccionarlos con `module`:

```ts
const normalizeTitle: EntityBehaviorModule = {
  id: "acme/normalize-title",
  operations: {
    create: async (context, next) => {
      const input = context.input as Record<string, unknown>;
      input.title = String(input.title).trim();
      await next();
    }
  }
};

createApp({ behaviorModules: [normalizeTitle] });
```

Después se declara desde runtime:

```json
{
  "name": "tasks",
  "namespace": "acme.work",
  "module": "acme/normalize-title",
  "definition": "type Task = { title: string }"
}
```

Las operaciones posibles son `create`, `bulkCreate`, `list`, `get`, `replace`, `update` y `delete`. El `context` expone input validado, registro actual, resultado, request normalizado y runtime. `await next()` ejecuta el CRUD genérico; omitirlo permite reemplazarlo mediante `context.result`.

## Activar el catálogo

El catálogo de entidades está activo por defecto. Para ejecutar solo módulos instalados por código:

```bash
EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start
```

En ese modo, `/v1/entities` devuelve `404`.

# Arquitectura de ZFC

## Propósito

ZFC expone conjuntos definidos en tiempo de ejecución como recursos REST. Un conjunto se crea enviando un alias de tipo TypeScript simplificado; una vez desplegado, recibe las rutas CRUD habituales sin añadir rutas manuales.

```text
POST /v1/entities          → define el conjunto `tasks`
POST /v1/tasks             → crea un elemento o importa una lista
GET /v1/tasks              → lista elementos
GET /v1/tasks/:id          → obtiene un elemento
PUT /v1/tasks/:id          → lo reemplaza
PATCH /v1/tasks/:id        → lo modifica parcialmente
DELETE /v1/tasks/:id       → lo elimina
```

## Flujo de una solicitud

```text
HTTP request
  → httpAdapterMiddleware
  → restPatternMiddleware
  → responseRepositoryMiddleware
  → payloadPatternMiddleware
  → requestRepositoryMiddleware
  → entityLifecycleMiddleware
  → DomainResponse
  → HTTP response
```

`httpAdapterMiddleware` es la frontera con Node HTTP: encapsula `IncomingMessage` como método, URL y body textual; al final desencapsula un `DomainResponse` como status, headers y body HTTP. Ningún middleware interno escribe directamente sobre `ServerResponse`.

`restPatternMiddleware` interpreta `/vN/:entity/:id?`, comprueba que la entidad existe y traduce método y URL a una operación CRUD. Produce una representación neutral al transporte (`DomainRequest`) con versión, entidad, id y acción. Una entidad inexistente falla ahí con `404`.

`payloadPatternMiddleware` transforma el body en un patrón `one` (objeto) o `many` (array). Un array solo es válido para `POST` de colección y se convierte en `bulkCreate`. Los demás cuerpos de escritura son un único objeto. Así repositorios y hooks no reciben el request HTTP ni su body crudo.

`requestRepositoryMiddleware` persiste el `DomainRequest` ya normalizado. `entityLifecycleMiddleware` ejecuta la operación serializada y produce un `DomainResponse`. `responseRepositoryMiddleware` persiste ese resultado. La prioridad para `PATCH` y `PUT` es resolver primero el recurso, para que un id ausente responda `404` aun si el body es inválido.

`EntityRuntime` contiene el CRUD genérico. Valida los datos contra el esquema de la entidad y ejecuta hooks antes y después de crear, actualizar o borrar.

## Entidades y repositorios

Cada entidad instalada tiene:

- una `EntityDefinition`: nombre y campos admitidos;
- un `Repository<EntityRecord>`;
- hooks opcionales de ciclo de vida.

La interfaz `Repository` es el límite de persistencia. Hoy la implementación es `InMemoryRepository`, por lo que un reinicio borra los datos. Cambiar a una base de datos debe conservar esa interfaz y no cambiar el routing ni el runtime.

## La entidad de sistema `entities`

`entities` es una entidad normal instalada desde el módulo [src/entities/entities.ts](../src/entities/entities.ts), pero tiene reglas de negocio adicionales:

| Operación sobre `entities` | Efecto de ciclo de vida |
| --- | --- |
| Crear | valida el alias TypeScript y despliega una nueva entidad y repositorio |
| Editar | valida el esquema nuevo y actualiza la entidad desplegada, preservando sus registros |
| Borrar | retira del runtime la entidad y su endpoint |

De este modo las definiciones también viven en su propio repositorio y se consultan con `GET /v1/entities`.

### Catálogo activable

Al iniciar, la aplicación usa `installIfMissing` para registrar los módulos de sistema; el runtime no duplica una entidad ya instalada. El catálogo `entities` se carga por defecto, pero se puede desactivar con `EXENSIAL_ENABLE_ENTITY_CATALOG=false` o `createApp({ enableEntityCatalog: false })`. Con el catálogo desactivado, el motor CRUD continúa funcionando para módulos instalados por código, pero no expone la API para crear entidades dinámicamente.

### Contexto, namespace y módulo

Una definición enviada a `POST /v1/entities` puede incluir los campos opcionales `namespace` y `module`:

```json
{
  "name": "announcements",
  "namespace": "demo.content",
  "module": "example/normalize-title",
  "definition": "type Announcement = { title: string }"
}
```

`name` sigue siendo la identidad única y la ruta REST (`/v1/announcements`). `namespace` es contexto lógico, con una convención de puntos inspirada en packages (`empresa.area`), para organizar UI, permisos o catálogos futuros sin romper rutas existentes. `module` es el identificador estable de un comportamiento confiable registrado por la aplicación.

El servidor **no importa ni ejecuta código enviado por HTTP**. Los módulos se importan en el bootstrap de la aplicación y se entregan a `createApp({ behaviorModules: [...] })`; el request solo puede seleccionar uno de esos ids permitidos. Un id desconocido devuelve `400`.

## Middleware de operación de entidad

Una entidad puede agregar comportamiento a cada operación normalizada: `create`, `bulkCreate`, `list`, `get`, `replace`, `update` y `delete`. El contrato es un middleware con `context` y `next()`:

```ts
import type { EntityBehaviorModule } from "./application/entity-behaviors";

const normalizeTitle: EntityBehaviorModule = {
  id: "example/normalize-title",
  operations: {
    create: async (context, next) => {
      const input = context.input as Record<string, unknown>;
      input.title = String(input.title).trim().toUpperCase(); // antes del CRUD
      await next();                                           // CRUD genérico
      // context.result permite lógica posterior al CRUD
    }
  }
};
```

El runtime primero aplica el filtro y validación derivados del `type`; luego ejecuta estos middlewares y, al final, el CRUD genérico contra el repositorio. Llamar `await next()` complementa el comportamiento por defecto antes y después. No llamarlo permite reemplazarlo, siempre que el middleware asigne `context.result` cuando la operación deba devolver datos. `next()` solo puede invocarse una vez por capa.

El `context` incluye `runtime`, `request`, `definition`, `input` ya validado, `current` para operaciones sobre un registro y `result` después del CRUD. Esto evita entregar `IncomingMessage` o `ServerResponse` a la lógica de negocio.

## Entidades de transporte `requests` y `responses`

El propio pipeline es observable dentro del mismo dominio extensible:

- `requests` guarda versión, entidad, acción, id y payload normalizado de cada request REST reconocido.
- `responses` guarda status, body normalizado y referencia opcional al request que lo produjo.

Son `EntityModule` normales con repositorios propios, por lo que también se consultan por `GET /v1/requests` y `GET /v1/responses`. Se escriben desde middleware mediante `EntityRuntime`, no mediante HTTP, para evitar que el mecanismo de auditoría se audite recursivamente.

`DomainResponse` no conoce HTTP: solo contiene `status`, `body` y headers opcionales. Esto permite sustituir el adaptador HTTP por otro transporte sin modificar el runtime, los repositorios ni los hooks.

## Tipos admitidos

El parser acepta un subconjunto deliberadamente pequeño de alias TypeScript:

```ts
type Task = {
  title: string;
  pages: number;
  published?: boolean;
}
```

Admite `string`, `number`, `boolean`, `json` y el indicador opcional `?`. `json` sirve para conservar payloads y responses normalizados. No evalúa ni importa código recibido por HTTP: una definición enviada es declarativa, no ejecutable. Esto evita convertir el endpoint de definición en ejecución remota de código.

## Contrato REST versionado

La versión forma parte del patrón de URL: `/v1/:entity/:id?`. El runtime no mezcla versiones: hoy acepta el patrón `v` seguido por números y lo conserva en `DomainRequest` para que una futura capa pueda aplicar políticas o catálogos por versión.

| Método y ruta | Acción normalizada | Body |
| --- | --- | --- |
| `GET /v1/tasks` | `list` | — |
| `POST /v1/tasks` | `create` | objeto |
| `POST /v1/tasks` | `bulkCreate` | array de objetos |
| `GET /v1/tasks/:id` | `get` | — |
| `PUT /v1/tasks/:id` | `replace` | objeto completo |
| `PATCH /v1/tasks/:id` | `update` | objeto parcial |
| `DELETE /v1/tasks/:id` | `delete` | — |

La validación conserva solo el contrato declarado por la entidad y rechaza campos desconocidos o tipos inválidos antes de invocar el repositorio. Para importación masiva se validan todos los objetos antes de realizar la primera escritura.

## Entidades definidas en código

Una entidad con comportamiento ejecutable se expresa como un `EntityModule` TypeScript, con `definition` y hooks. Se instala al crear la app mediante `createApp({ modules })`. El middleware REST no necesita conocer ese módulo: cualquier módulo instalado obtiene automáticamente el mismo CRUD.

## Metadatos humanos y localizados

La definición del tipo acepta JSDoc como convención de documentación. Los tags admitidos son `@zfc.title` y `@zfc.description`, seguidos por locale y texto. Se pueden aplicar antes del alias para documentar la entidad, o antes de un campo para documentarlo.

```ts
/**
 * @zfc.title en Tasks
 * @zfc.title es Tareas
 * @zfc.description en A task collection
 */
type Task = {
  /**
   * @zfc.title en Title
   * @zfc.title es Título
   * @zfc.description en The task's public title
   */
  name: string;
}
```

Los metadatos se preservan completos en `documentation` y se emiten en OpenAPI como extensión `x-zfc-localized`. OpenAPI usa inglés, o el primer locale disponible, para sus propiedades estándar `title` y `description`. Una futura UI puede elegir cualquier locale de la extensión sin reinterpretar el tipo.

## OpenAPI y Swagger dinámicos

`GET /openapi.json` crea un documento OpenAPI 3.0.4 en cada request a partir de las entidades instaladas, sus campos, campos requeridos y metadatos localizados. Al crear, editar o borrar una definición en `entities`, el siguiente documento refleja el cambio.

Cada esquema también expone `x-exensial-context`, con el `namespace`, id de `module` y lista de operaciones interceptadas. Swagger muestra el CRUD completo que sigue existiendo para la entidad; la extensión permite que clientes humanos o UI especializadas indiquen qué lógica adicional participa.

`GET /docs` entrega una página Swagger UI que consume `/openapi.json`. Para mantener el proyecto sin dependencias de frontend, los assets de Swagger UI se cargan desde `unpkg`; la especificación JSON sigue estando disponible aunque el navegador no tenga acceso a ese CDN. En un despliegue sin acceso externo se puede sustituir esa página por assets locales de `swagger-ui-dist` sin cambiar el generador OpenAPI.

## Decisiones técnicas

- **Node HTTP, sin framework:** reduce dependencias y deja visible el mecanismo de middleware; un framework puede sustituir esta capa después sin cambiar el dominio.
- **TypeScript ejecutado por `tsx`:** el proyecto usa imports relativos sin extensión y no genera `dist`. `tsx` resuelve y transpila el fuente durante desarrollo y ejecución.
- **`tsc --noEmit` para tipos:** ejecutar TypeScript no sustituye el chequeo estático; `npm run check` debe mantenerse en CI.
- **Hooks y repositorio separados:** las reglas de negocio no viven en las rutas y la persistencia no depende de HTTP.
- **Requests y responses como entidades:** la auditoría usa el mismo runtime y repositorio que el resto del dominio, en vez de introducir un mecanismo lateral de logging.
- **Adaptador HTTP aislado:** el dominio produce `DomainResponse`; solo el middleware externo conoce el protocolo HTTP y escribe la respuesta.
- **JSDoc localizado como fuente de metadatos:** evita duplicar descripciones entre tipos, Swagger y UI, y permite que cada consumidor elija idioma.
- **OpenAPI generado en runtime:** las entidades dinámicas se documentan sin una fase manual de sincronización.
- **Errores de dominio explícitos:** conflictos, validación y recursos ausentes se traducen a `409`, `400` y `404` respectivamente.

## Límites actuales

- Persistencia solo en memoria.
- No hay autenticación, autorización, paginación ni migraciones de datos.
- Al editar una definición, los registros existentes no se revalidan automáticamente contra el nuevo esquema.
- Solo existe el happy path de tipos escalares y `json`; relaciones, arrays tipados, fechas y restricciones adicionales son extensiones futuras.

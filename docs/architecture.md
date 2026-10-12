# Arquitectura de ZFC

## Propósito

ZFC expone conjuntos definidos en tiempo de ejecución como recursos REST. Un conjunto se crea enviando un alias de tipo TypeScript simplificado; una vez desplegado, recibe las rutas CRUD habituales sin añadir rutas manuales.

```text
POST /v1/entities          → define el conjunto `books`
POST /v1/books             → crea un elemento o importa una lista
GET /v1/books              → lista elementos
GET /v1/books/:id          → obtiene un elemento
PUT /v1/books/:id          → lo reemplaza
PATCH /v1/books/:id        → lo modifica parcialmente
DELETE /v1/books/:id       → lo elimina
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

## Entidades de transporte `requests` y `responses`

El propio pipeline es observable dentro del mismo dominio extensible:

- `requests` guarda versión, entidad, acción, id y payload normalizado de cada request REST reconocido.
- `responses` guarda status, body normalizado y referencia opcional al request que lo produjo.

Son `EntityModule` normales con repositorios propios, por lo que también se consultan por `GET /v1/requests` y `GET /v1/responses`. Se escriben desde middleware mediante `EntityRuntime`, no mediante HTTP, para evitar que el mecanismo de auditoría se audite recursivamente.

`DomainResponse` no conoce HTTP: solo contiene `status`, `body` y headers opcionales. Esto permite sustituir el adaptador HTTP por otro transporte sin modificar el runtime, los repositorios ni los hooks.

## Tipos admitidos

El parser acepta un subconjunto deliberadamente pequeño de alias TypeScript:

```ts
type Book = {
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
| `GET /v1/books` | `list` | — |
| `POST /v1/books` | `create` | objeto |
| `POST /v1/books` | `bulkCreate` | array de objetos |
| `GET /v1/books/:id` | `get` | — |
| `PUT /v1/books/:id` | `replace` | objeto completo |
| `PATCH /v1/books/:id` | `update` | objeto parcial |
| `DELETE /v1/books/:id` | `delete` | — |

La validación conserva solo el contrato declarado por la entidad y rechaza campos desconocidos o tipos inválidos antes de invocar el repositorio. Para importación masiva se validan todos los objetos antes de realizar la primera escritura.

## Entidades definidas en código

Una entidad con comportamiento ejecutable se expresa como un `EntityModule` TypeScript, con `definition` y hooks. Se instala al crear la app mediante `createApp({ modules })`. El middleware REST no necesita conocer ese módulo: cualquier módulo instalado obtiene automáticamente el mismo CRUD.

## Decisiones técnicas

- **Node HTTP, sin framework:** reduce dependencias y deja visible el mecanismo de middleware; un framework puede sustituir esta capa después sin cambiar el dominio.
- **TypeScript ejecutado por `tsx`:** el proyecto usa imports relativos sin extensión y no genera `dist`. `tsx` resuelve y transpila el fuente durante desarrollo y ejecución.
- **`tsc --noEmit` para tipos:** ejecutar TypeScript no sustituye el chequeo estático; `npm run check` debe mantenerse en CI.
- **Hooks y repositorio separados:** las reglas de negocio no viven en las rutas y la persistencia no depende de HTTP.
- **Requests y responses como entidades:** la auditoría usa el mismo runtime y repositorio que el resto del dominio, en vez de introducir un mecanismo lateral de logging.
- **Adaptador HTTP aislado:** el dominio produce `DomainResponse`; solo el middleware externo conoce el protocolo HTTP y escribe la respuesta.
- **Errores de dominio explícitos:** conflictos, validación y recursos ausentes se traducen a `409`, `400` y `404` respectivamente.

## Límites actuales

- Persistencia solo en memoria.
- No hay autenticación, autorización, paginación ni migraciones de datos.
- Al editar una definición, los registros existentes no se revalidan automáticamente contra el nuevo esquema.
- Solo existe el happy path de tipos escalares; relaciones, arrays, fechas y restricciones adicionales son extensiones futuras.

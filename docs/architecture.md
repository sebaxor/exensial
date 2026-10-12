# Arquitectura de ZFC

## Propósito

ZFC expone conjuntos definidos en tiempo de ejecución como recursos REST. Un conjunto se crea enviando un alias de tipo TypeScript simplificado; una vez desplegado, recibe las rutas CRUD habituales sin añadir rutas manuales.

```text
POST /entities             → define el conjunto `books`
POST /books                → crea un elemento
GET /books                 → lista elementos
GET /books/:id             → obtiene un elemento
PATCH /books/:id           → lo modifica
DELETE /books/:id          → lo elimina
```

## Flujo de una solicitud

```text
HTTP request
  → restOperationMiddleware
  → entityLifecycleMiddleware
  → EntityRuntime
  → Repository
```

`restOperationMiddleware` interpreta `/:entity/:id?`, comprueba que la entidad existe y traduce método y URL a una operación CRUD. Una entidad inexistente falla ahí con `404`.

`entityLifecycleMiddleware` lee el body cuando corresponde, ejecuta la operación y traduce los errores de dominio a HTTP. La prioridad para `PATCH` es resolver primero el recurso, para que un id ausente responda `404` aun si el body es inválido.

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

De este modo las definiciones también viven en su propio repositorio y se consultan con `GET /entities`.

## Tipos admitidos

El parser acepta un subconjunto deliberadamente pequeño de alias TypeScript:

```ts
type Book = {
  title: string;
  pages: number;
  published?: boolean;
}
```

Admite `string`, `number`, `boolean` y el indicador opcional `?`. No evalúa ni importa código recibido por HTTP: una definición enviada es declarativa, no ejecutable. Esto evita convertir el endpoint de definición en ejecución remota de código.

## Entidades definidas en código

Una entidad con comportamiento ejecutable se expresa como un `EntityModule` TypeScript, con `definition` y hooks. Se instala al crear la app mediante `createApp({ modules })`. El middleware REST no necesita conocer ese módulo: cualquier módulo instalado obtiene automáticamente el mismo CRUD.

## Decisiones técnicas

- **Node HTTP, sin framework:** reduce dependencias y deja visible el mecanismo de middleware; un framework puede sustituir esta capa después sin cambiar el dominio.
- **TypeScript ejecutado por `tsx`:** el proyecto usa imports relativos sin extensión y no genera `dist`. `tsx` resuelve y transpila el fuente durante desarrollo y ejecución.
- **`tsc --noEmit` para tipos:** ejecutar TypeScript no sustituye el chequeo estático; `npm run check` debe mantenerse en CI.
- **Hooks y repositorio separados:** las reglas de negocio no viven en las rutas y la persistencia no depende de HTTP.
- **Errores de dominio explícitos:** conflictos, validación y recursos ausentes se traducen a `409`, `400` y `404` respectivamente.

## Límites actuales

- Persistencia solo en memoria.
- No hay autenticación, autorización, paginación ni migraciones de datos.
- Al editar una definición, los registros existentes no se revalidan automáticamente contra el nuevo esquema.
- Solo existe el happy path de tipos escalares; relaciones, arrays, fechas y restricciones adicionales son extensiones futuras.

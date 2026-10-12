# ZFC

API mínima para definir conjuntos dinámicos y operar sus elementos mediante REST.

El código fuente se ejecuta directamente con `tsx`; los imports internos no llevan extensión.

```bash
npm install
npm test
npm start
```

Define un conjunto enviando un alias de tipo TypeScript (por ahora admite campos `string`, `number`, `boolean` y `json`):

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"tasks","definition":"type Task = { title: string; completed?: boolean }"}'
```

Después, el nombre se convierte en el recurso REST:

```bash
# Crear
curl -X POST http://localhost:3000/v1/tasks -H 'content-type: application/json' -d '{"title":"Draft the report"}'

# Listar / leer uno
curl http://localhost:3000/v1/tasks
curl http://localhost:3000/v1/tasks/:id

# Actualizar / borrar
curl -X PATCH http://localhost:3000/v1/tasks/:id -H 'content-type: application/json' -d '{"completed":true}'
curl -X DELETE http://localhost:3000/v1/tasks/:id
```

`entities` es también una entidad del sistema: su repositorio conserva las definiciones y sus hooks de ciclo de vida despliegan, actualizan o retiran las entidades dinámicas. Los datos son intencionalmente en memoria para este primer corte: al reiniciar el proceso se vacían.

También se pueden instalar entidades escritas como módulos TypeScript al crear la app. Un módulo puede declarar `definition` y hooks de ciclo de vida; después recibe el mismo CRUD REST genérico.

Cada request REST reconocido y cada resultado se conservan, respectivamente, como entidades de sistema consultables en `/v1/requests` y `/v1/responses`.

La especificación dinámica está en `/openapi.json` y la interfaz Swagger está en `/docs`.

Consulta [la arquitectura y las decisiones técnicas](docs/architecture.md) para el diseño completo.

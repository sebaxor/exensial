# Runtime domain labs

A runtime domain lab is a small, independent software implementation installed through Exensial's HTTP API. A lab is not server source code: it is a set of entity definitions, declarative rules and/or TypeScript domain modules, and sample records stored at runtime.

Each lab follows the same shape:

1. **Domain definition** — compact JSON declarations for entities and their `logic` or `code`.
2. **Runtime installation** — the definitions are sent to `POST /v1/entities`.
3. **Sample scenario** — records exercise the installed rules through normal REST CRUD.
4. **Curl appendix** — exact HTTP commands reproduce the lab from an empty in-memory service.

The reusable Exensial runtime provides HTTP handling, route matching, schema validation, repositories, CRUD, audit records, rule interpretation, code execution, and OpenAPI. A lab supplies only domain-relevant names, fields, invariants, and state transitions. Uploaded `code` is a controlled-development feature; see [runtime TypeScript domain modules](../runtime-code.md).

Labs are independent by namespace. They can be removed by deleting their `entities` records, and a process restart clears every runtime definition because the current repository is in memory.

## Available labs

- [Library circulation](library.md): catalog copies, members, loans, availability reservation, and return.

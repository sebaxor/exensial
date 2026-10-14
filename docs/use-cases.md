# UseCases

The UseCases layer owns runtime business operations that mutate one or more entity collections. It is installed above Entities and Queries: entities define record shape, ExensialQuery reads them, and a UseCase resolves declared record IDs and performs domain changes through the narrow entity-record API.

`useCases` is itself a system entity. A definition is installed with ordinary CRUD:

```json
{
  "useCaseId": "Library_ReturnLoans",
  "name": "Return selected loans",
  "route": { "namespace": "library", "entity": "loans", "action": "return", "method": "POST" },
  "inputs": [{ "name": "loans", "entity": "loans", "namespace": "library", "minItems": 1 }],
  "code": "export default async ({ inputs, records }) => { /* domain logic */ }"
}
```

This produces `POST /v1/library/loans/return`. Its body is always shaped as lists of opaque IDs:

```json
{ "inputs": { "loans": ["loan-id-1", "loan-id-2"] } }
```

Before executing uploaded code, Exensial validates cardinality and resolves each ID to the declared entity. Runtime code receives `inputs` as records, a narrow `records.get/create/update` API, and `fail(message)`. It receives neither HTTP objects nor repositories.

The generated OpenAPI operation carries `x-exensial-usecase`, including the UseCase ID and input contract. The Library lab installs `Library_ReturnLoans`; it returns one or many active loans, increments each book's available-copy count, and sets the loan status and return timestamp.

Endpoint permissions remain backward-compatible in this MVP. The next migration makes generated CRUD operations first-class UseCases and lets authorization target UseCase IDs rather than HTTP path patterns. That requires migrating existing permission records and console authorization metadata together; it is intentionally not silently changed here.

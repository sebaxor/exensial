# Entity and API versioning

Runtime entities use semantic versions such as `1.0.0`. The major number is the HTTP API version:

```json
{ "name": "books", "namespace": "library", "version": "1.2.0", "definition": "type Book = { title: string }" }
```

This entity is served at `/v1/library/books`. If several `1.x.y` definitions of the same `(namespace, name)` are installed, Exensial selects the highest semantic version for `/v1`. A `2.x.y` definition is independently served under `/v2`.

`GET /openapi.json?version=1` generates the document for major version 1. Without `version`, Exensial uses the highest installed major. Swagger forwards its query string to the generated document.

The catalog accepts legacy records without `version` as `1.0.0` during this MVP migration. New definitions should always send an explicit version.

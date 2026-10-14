# ExensialQuery HTTP capability

> This document describes the existing OData-like HTTP lookup capability. The separate reusable SQL-subset package lives in [`packages/exensialquery`](../packages/exensialquery/README.md). Both are intentionally read-only, but they are different transports/dialects today.

`ExensialQuery` is an optional, read-only HTTP capability for metadata-driven consumers such as the Exensial Console. It is not part of the base CRUD contract and it is not a replacement for an eventual OData or GraphQL implementation.

When enabled (the default), `/openapi.json` exposes the root in `x-exensial-capabilities.query.exensialQuery` and adds one documented query operation per active entity. Disable it with `EXENSIAL_ENABLE_EXENSIAL_QUERY=false` or `createApp({ enableExensialQuery: false })`. A consumer must discover the capability from OpenAPI before using it.

## Endpoint

The root is `/v1/query/exensial`:

```text
GET /v1/query/exensial/{entity}
GET /v1/query/exensial/{namespace}/{entity}
```

It accepts an OData-like subset:

- `$filter`: `contains`, `startswith`, `endswith`, `eq`, `ne`, `gt`, `ge`, `lt`, and `le`; join conditions with `and` or `or`.
- `$skip`: records to omit; defaults to `0`.
- `$top`: records to return; defaults to `25`, maximum `100`.

The response is a JSON array and carries `X-Total-Count`, `X-Query-Skip`, and `X-Query-Top` headers.

When endpoint permissions are enabled, a query route is authorized by its own HTTP path. For example, grant `GET /v1/query/exensial/library/books*` to make the library-book lookup public, or `GET /v1/query/exensial/*` to an administrative role. A CRUD rule for `/v1/library/books*` does not implicitly cover the query capability.

```bash
curl --get 'http://localhost:3000/v1/query/exensial/library/books' \
  --data-urlencode "\$filter=contains(title, 'sample') or contains(author, 'sample')" \
  --data-urlencode '\$top=25'
```

## Explicit searchable fields

Fields are private to filtering unless their runtime type definition opts in. This keeps a future database-backed repository free to enforce indexes, authorization, or different query compilation without changing the public schema.

```ts
type Book = {
  /** @exensial.ui.searchable */
  title: string;
  /** @exensial.ui.searchable */
  author: string;
  /** @exensial.ui.filterable */
  copiesAvailable: number;
}
```

`searchable` permits text functions and equality. `filterable` permits equality and numeric comparisons. Unsupported fields, malformed filters, and inappropriate operators return `400`; filters are parsed and compiled to a repository predicate, never evaluated as JavaScript, SQL, or uploaded domain code.

The Console uses this capability for relation fields with more than 25 records. It opens a dedicated lookup dialog with a fixed-height result grid, pagination, and one filter per searchable field, rather than embedding a large select in the create/edit form. The user explicitly selects one grid row. Filter input is debounced for 300 ms once a term reaches three characters (700 ms for shorter terms), avoiding a request per keystroke. If the capability is unavailable or the target collection has 25 or fewer records, the Console preserves the plain CRUD-backed select.

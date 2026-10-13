# ExensialQuery capability

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

The Console uses this capability for relation fields with more than 25 records. It opens a dedicated lookup dialog with a result grid and one filter per searchable field, rather than embedding a large select in the create/edit form. The user explicitly selects one grid row. If the capability is unavailable or the target collection has 25 or fewer records, the Console preserves the plain CRUD-backed select.

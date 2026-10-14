# Views and Menus

The Views layer is an optional Exensial capability. Enable it by default or set `EXENSIAL_ENABLE_VIEWS=false` to omit its system entities and manifest endpoint.

## Installed system entities

The layer installs ordinary runtime entities, so their definitions appear in `/v1/entities` and their records use standard CRUD:

- `/v1/views` stores named QueryView and DetailView definitions.
- `/v1/menus` stores menu placement independently from a view.

Every record has Exensial's opaque infrastructure `id`. `viewId` and `menuId` are stable application-level identifiers used by definitions and menu references.

## View definition

```json
{
  "viewId": "Library_Book_QueryView",
  "kind": "query",
  "name": "Library books",
  "target": {
    "namespace": "library",
    "entity": "books",
    "slot": "query"
  },
  "source": {
    "language": "exensialquery",
    "ast": { "type": "select" }
  }
}
```

`target` makes an explicit view override the generated CRUD view for the same entity and slot.

## Executing a QueryView

The central endpoint executes the persisted AST. Callers supply only scalar parameters; they cannot replace the query definition:

```bash
curl -X POST http://localhost:3000/v1/views/Library_Book_QueryView/data \
  -H 'content-type: application/json' \
  -d '{"parameters":{"active":true}}'
```

The response is `{ "viewId": "...", "items": [...] }`. The initial `in-memory` query target reads the entities named by the AST and runs the portable `exensialquery` executor. It strips sensitive fields and, when endpoint permissions are installed, validates `GET` access for every source entity before it executes a view.

The OpenAPI capability advertises `exensialquery` as `named-views`: it is available through persisted QueryViews, not yet as a general ad-hoc AST endpoint.

## Menu definition

```json
{
  "menuId": "library.books",
  "position": 10,
  "visible": true,
  "icon": "book,📚",
  "viewId": "Library_Book_QueryView"
}
```

`parentId` is optional and references another `menuId`. Entries are ordered by `position`, then by `menuId`. Visibility is presentation metadata only; it never grants access to view data.

## Discovery

OpenAPI advertises the capability without violating the OpenAPI standard:

```json
{
  "x-exensial-capabilities": {
    "views": {
      "catalogPath": "/v1/views",
      "menuCatalogPath": "/v1/menus",
      "manifestPath": "/v1/views/manifest"
    }
  }
}
```

Clients fetch `GET /v1/views/manifest` once after capability discovery. The response combines explicit views/menus with default CRUD views synthesized from every active entity. An explicit view with a matching `target` replaces the corresponding default query or detail view.

The complete intended design and delivery sequence are documented in [the layered architecture plan](views-and-layered-architecture-plan.md).

# Runtime localization

`localizations` is a system entity. Its records are data, so translations can be created, changed, and deleted through the same REST CRUD used by application entities.

```json
{
  "locale": "es",
  "key": "entity.library.books.title",
  "value": "Libros de la biblioteca"
}
```

## Keys

The stable metadata keys currently supported by generated OpenAPI and the Console are:

- `openapi.info.title` and `openapi.info.description`
- `entity.<namespace.name-or-name>.title`
- `entity.<namespace.name-or-name>.description`
- `entity.<namespace.name-or-name>.field.<field>.title`
- `entity.<namespace.name-or-name>.field.<field>.description`
- `ui.<name>` for generic Console text, for example `ui.save`, `ui.cancel`, `ui.edit`, `ui.delete`, `ui.previous`, and `ui.next`

For example, a book title field in `library/books` is addressed as `entity.library.books.field.title.title`.

## Selecting a language

English is the fallback. Request localized generated metadata with `?lang=<locale>`:

```text
GET /openapi.json?lang=es
GET /docs?lang=es
GET /console?lang=es#/library.books
```

Both Swagger and the Console expose a language selector, remember the selected locale in browser storage, and reload their generated OpenAPI document with that parameter. The Console reads selected `ui.*` records from `x-exensial-ui-localization`, so its own controls are translated along with entity menus and fields. The standard OpenAPI fields remain standard (`title`, `description`, and so on); Exensial also retains the complete source locale map under `x-exensial-localized` for clients that need it.

When there is no matching runtime record, Exensial uses a matching JSDoc locale, then English, then the first available JSDoc text. This keeps existing entity definitions backward compatible.

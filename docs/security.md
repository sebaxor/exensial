# Authentication and endpoint permissions

Security is an optional infrastructure layer (`EXENSIAL_ENABLE_SECURITY=false` disables it). It is deliberately separate from entity CRUD: entities do not know about HTTP credentials, while the authorization middleware evaluates a request before it reaches their CRUD pipeline.

The layer installs three ordinary System entities, so they are available through the same repository and REST conventions as every other entity:

- `roles` — named groups such as `library-admin`.
- `users` — a username, an `active` flag, a JSON list of role names, and a hidden password hash.
- `permissions` — `{ role, method, path, effect }`. `effect` is `allow` or `deny`; a trailing `*` in `path` matches a prefix and an applicable deny wins. The reserved role `anonymous` can explicitly allow a public route when a broader role rule also matches it.

`POST /v1/auth/login` accepts `{ "username", "password" }` and produces an HS256 Bearer JWT valid for eight hours. Set `EXENSIAL_JWT_SECRET` outside development. The local JWT adapter is intentionally narrow; an OIDC, session-cookie, or gateway adapter only needs to populate the same principal (`id`, `username`, and `roles`) before the authorization middleware.

## Policy evaluation

1. Find permissions with the request method (or `*`) and matching path.
2. If there are no matching rules, the endpoint permits anonymous access. A rule for the special `anonymous` role can also keep one endpoint public while a broader role rule covers related routes.
3. If rules exist, a missing or invalid Bearer token returns `401` with `WWW-Authenticate: Bearer`.
4. A signed-in user whose roles do not match an allow returns `403`. A matching deny also returns `403`.

For example, the lab explicitly allows `anonymous` to `GET /v1/library/books*`, allows `library-reader` to `GET /v1/*`, and adds administrative write rules separately. This keeps the catalog public without accidentally making every route matched by the broad reader rule require a token.

## Library lab with permissions

The normal library lab remains anonymous:

```bash
npm run lab:library
```

The protected variant uses the same runtime business definitions and adds security data after fixtures are loaded:

```bash
npm run lab:library:permissions
```

It creates `reader` / `reader123` with the `library-reader` role and `admin` / `admin123` with `library-admin`. Book reads stay anonymous. The reader can use every `GET` endpoint; changes to books, members, loans, and System catalogs require the admin token. Sensitive fields such as `users.passwordHash` are redacted from HTTP representations for every role.

```bash
curl -sS -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"username":"admin","password":"admin123"}'

curl -X POST http://localhost:3000/v1/library/books \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  --data '{"title":"New book","author":"A. Author","isbn":"978-0000000000","copiesTotal":1}'
```

The generated OpenAPI document exposes the login endpoint and Bearer scheme. Individual entity operations remain generic because authorization is a runtime policy, not a change to domain logic.

## OpenAPI and Console metadata

The standard OpenAPI `security: [{ bearerAuth: [] }]` property appears on operations that currently require a token. Public operations with an explicit `anonymous` allow remain standard-public and do not receive that property. Exensial adds the non-standard, UI-oriented `x-exensial-authorization` extension to every operation with matching policy rules:

```json
{
  "security": [{ "bearerAuth": [] }],
  "x-exensial-authorization": {
    "required": true,
    "rules": [{ "role": "library-admin", "method": "POST", "path": "/v1/library/books*", "effect": "allow" }]
  }
}
```

The extension is a snapshot of the runtime policy, not a security decision by itself: the middleware remains authoritative. The Console uses it to hide collections without readable access and create, edit, or delete controls the active principal cannot use. It offers **Sign in** when protected operations exist, stores the issued token in browser storage, and sends it as a Bearer token. Swagger can use the standard scheme through its Authorize control.

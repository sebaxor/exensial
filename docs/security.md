# Authentication and endpoint permissions

Security is an optional infrastructure layer (`EXENSIAL_ENABLE_SECURITY=false` disables it). It is deliberately separate from entity CRUD: entities do not know about HTTP credentials, while the authorization middleware evaluates a request before it reaches their CRUD pipeline.

The layer installs three ordinary System entities, so they are available through the same repository and REST conventions as every other entity:

- `roles` — named groups such as `library-admin`.
- `users` — a username, an `active` flag, a JSON list of role names, and a hidden password hash.
- `permissions` — `{ role, method, path, effect }`. `effect` is `allow` or `deny`; a trailing `*` in `path` matches a prefix and an applicable deny wins.

`POST /v1/auth/login` accepts `{ "username", "password" }` and produces an HS256 Bearer JWT valid for eight hours. Set `EXENSIAL_JWT_SECRET` outside development. The local JWT adapter is intentionally narrow; an OIDC, session-cookie, or gateway adapter only needs to populate the same principal (`id`, `username`, and `roles`) before the authorization middleware.

## Policy evaluation

1. Find permissions with the request method (or `*`) and matching path.
2. If there are no matching rules, the endpoint permits anonymous access. This makes public endpoints explicit by omission.
3. If rules exist, a missing or invalid Bearer token returns `401` with `WWW-Authenticate: Bearer`.
4. A signed-in user whose roles do not match an allow returns `403`. A matching deny also returns `403`.

For example, leave `GET /v1/library/books` without a permission for a public catalog, and add an admin allow for `POST /v1/library/books*` to restrict catalog changes.

## Library lab with permissions

The normal library lab remains anonymous:

```bash
npm run lab:library
```

The protected variant uses the same runtime business definitions and adds security data after fixtures are loaded:

```bash
npm run lab:library:permissions
```

It creates `reader` / `reader123` with the `library-reader` role and `admin` / `admin123` with `library-admin`. Book reads stay anonymous; changes to books, all member and loan routes, and System catalogs require the admin token.

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

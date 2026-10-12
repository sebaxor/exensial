# Library circulation runtime lab

This lab installs a small library application entirely through Exensial's REST API. It has three entities:

- `library/books`: catalog entries with total and currently available copies.
- `library/members`: library members.
- `library/loans`: a loan of one copy to one member.

The reusable runtime contains no knowledge of books or loans. Everything below is runtime data stored in the `entities` catalog.

## Domain definitions

### Books

```json
{
  "name": "books",
  "namespace": "library",
  "definition": "type Book = { title: string; author: string; isbn: string; copiesTotal: number; copiesAvailable?: number }",
  "logic": {
    "create": {
      "before": [
        { "type": "normalize", "fields": ["title", "author", "isbn"] },
        { "type": "normalize", "mode": "upper", "fields": ["isbn"] },
        { "type": "validate", "required": ["title", "author", "isbn"], "positiveIntegers": ["copiesTotal"] },
        { "type": "copy", "from": "copiesTotal", "to": "copiesAvailable" }
      ]
    }
  }
}
```

Business meaning: titles, authors, and ISBNs are trimmed; ISBNs are uppercased; a book needs at least one total copy; the available-copy count starts equal to the total-copy count. The caller does not set `copiesAvailable` during creation.

### Members

```json
{
  "name": "members",
  "namespace": "library",
  "definition": "type Member = { name: string; email: string; active?: boolean }",
  "logic": {
    "create": {
      "before": [
        { "type": "normalize", "fields": ["name", "email"] },
        { "type": "normalize", "mode": "lower", "fields": ["email"] },
        { "type": "validate", "required": ["name", "email"] },
        { "type": "set", "field": "active", "value": true }
      ]
    }
  }
}
```

Business meaning: member data is normalized and every new member starts active.

### Loans

```json
{
  "name": "loans",
  "namespace": "library",
  "definition": "type Loan = { bookId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt?: string; status?: string }",
  "logic": {
    "create": {
      "before": [
        { "type": "normalize", "fields": ["memberId"] },
        { "type": "validate", "required": ["bookId", "memberId", "borrowedAt", "dueAt"], "isoDates": ["borrowedAt", "dueAt"], "dateOrder": { "earlier": "borrowedAt", "later": "dueAt" } },
        { "type": "set", "field": "status", "value": "active" },
        { "type": "reserve", "entityName": "books", "namespace": "library", "idField": "bookId", "field": "copiesAvailable" }
      ]
    },
    "update": {
      "before": [
        { "type": "transition", "field": "status", "from": "active", "to": "returned", "required": ["returnedAt"], "isoDates": ["returnedAt"] }
      ],
      "after": [
        { "type": "release", "entityName": "books", "namespace": "library", "idSource": "current", "idField": "bookId", "field": "copiesAvailable", "capacityField": "copiesTotal" }
      ]
    },
    "bulkCreate": { "before": [{ "type": "reject", "message": "Bulk loans are not allowed" }] },
    "delete": { "before": [{ "type": "assert", "source": "current", "field": "status", "rule": "notEquals", "value": "active", "message": "Active loans cannot be deleted" }] }
  }
}
```

Business meaning:

- A loan needs a book, member, valid borrow date, and later due date.
- Creating a loan sets `status` to `active` and reserves one available copy. No copy means no loan.
- Returning a loan is the only accepted loan update. It requires `returnedAt`, changes the status to `returned`, and releases one copy.
- Active loans cannot be deleted and loan imports are rejected.

## Rule vocabulary used by this lab

| Rule | Domain intention |
| --- | --- |
| `normalize` | Trim text and optionally change case. |
| `validate` | Require fields, validate dates, and apply simple numeric constraints. |
| `copy` | Derive one input field from another. |
| `set` | Set a business state owned by the workflow. |
| `reserve` | Decrement an integer availability field; reject when no copy remains. |
| `transition` | Allow one explicit state change and require return data. |
| `release` | Increment availability without exceeding total capacity. |

## Appendix A: runtime installation curls

Run these commands against an empty service. The definitions are the same domain declarations shown above.

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"books","namespace":"library","definition":"type Book = { title: string; author: string; isbn: string; copiesTotal: number; copiesAvailable?: number }","logic":{"create":{"before":[{"type":"normalize","fields":["title","author","isbn"]},{"type":"normalize","mode":"upper","fields":["isbn"]},{"type":"validate","required":["title","author","isbn"],"positiveIntegers":["copiesTotal"]},{"type":"copy","from":"copiesTotal","to":"copiesAvailable"}]}}}'
```

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"members","namespace":"library","definition":"type Member = { name: string; email: string; active?: boolean }","logic":{"create":{"before":[{"type":"normalize","fields":["name","email"]},{"type":"normalize","mode":"lower","fields":["email"]},{"type":"validate","required":["name","email"]},{"type":"set","field":"active","value":true}]}}}'
```

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"loans","namespace":"library","definition":"type Loan = { bookId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt?: string; status?: string }","logic":{"create":{"before":[{"type":"normalize","fields":["memberId"]},{"type":"validate","required":["bookId","memberId","borrowedAt","dueAt"],"isoDates":["borrowedAt","dueAt"],"dateOrder":{"earlier":"borrowedAt","later":"dueAt"}},{"type":"set","field":"status","value":"active"},{"type":"reserve","entityName":"books","namespace":"library","idField":"bookId","field":"copiesAvailable"}]},"update":{"before":[{"type":"transition","field":"status","from":"active","to":"returned","required":["returnedAt"],"isoDates":["returnedAt"]}],"after":[{"type":"release","entityName":"books","namespace":"library","idSource":"current","idField":"bookId","field":"copiesAvailable","capacityField":"copiesTotal"}]},"bulkCreate":{"before":[{"type":"reject","message":"Bulk loans are not allowed"}]},"delete":{"before":[{"type":"assert","source":"current","field":"status","rule":"notEquals","value":"active","message":"Active loans cannot be deleted"}]}}}'
```

## Appendix B: sample scenario curls

```bash
curl -X POST http://localhost:3000/v1/library/books \
  -H 'content-type: application/json' \
  -d '{"title":"  The Left Hand of Darkness  ","author":" Ursula K. Le Guin ","isbn":"978-0441478125","copiesTotal":2}'

curl -X POST http://localhost:3000/v1/library/members \
  -H 'content-type: application/json' \
  -d '{"name":"  Ana Torres  ","email":" ANA.TORRES@EXAMPLE.COM "}'
```

Use the `id` values returned by those commands:

```bash
curl -X POST http://localhost:3000/v1/library/loans \
  -H 'content-type: application/json' \
  -d '{"bookId":"<book-id>","memberId":"<member-id>","borrowedAt":"2026-10-12T10:00:00.000Z","dueAt":"2026-10-26T10:00:00.000Z"}'

curl -X PATCH http://localhost:3000/v1/library/loans/<loan-id> \
  -H 'content-type: application/json' \
  -d '{"status":"returned","returnedAt":"2026-10-20T15:30:00.000Z"}'
```

Inspect the installed definitions and the resulting application with:

```bash
curl http://localhost:3000/v1/entities
curl http://localhost:3000/v1/library/books
curl http://localhost:3000/v1/library/members
curl http://localhost:3000/v1/library/loans
```

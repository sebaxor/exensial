# Library circulation runtime lab

This is an independent runtime application: `library/books` owns catalog copies, `library/members` owns membership, and `library/loans` owns circulation. Exensial provides generic CRUD and a neutral collection facade; every rule about copies, members, and loans is installed as library code through `POST /v1/entities`.

## Data definitions

```ts
type Book = { title: string; author: string; isbn: string; copiesTotal: number; copiesAvailable?: number }
type Member = { name: string; email: string; active?: boolean }
type Loan = { bookId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt?: string; status?: string }
```

## Circulation policy

The book module trims bibliographic data, initializes availability, and prevents a total below borrowed copies. The member module normalizes identity data and activates new members. Both explicitly implement `create`, `bulkCreate`, and `update`, because import is a business operation.

The loan module speaks library language. `collection` is only the persistence-neutral boundary; it can later become a table repository and transaction without changing this policy.

```ts
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export default {
  create: async (context, next) => {
    const loan = context.input;
    const books = context.collection("books", "library");
    const members = context.collection("members", "library");
    const member = members.get(String(loan.memberId));
    const book = books.get(String(loan.bookId));
    if (!member?.active) context.fail("Member is not active");
    if (!book || Number(book.copiesAvailable) < 1) context.fail("Book is not available");
    if (!isDate(loan.borrowedAt) || !isDate(loan.dueAt) || Date.parse(loan.dueAt) <= Date.parse(loan.borrowedAt)) context.fail("A later valid dueAt is required");

    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 });
    try { loan.status = "active"; await next(); }
    catch (error) { await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) }); throw error; }
  },
  update: async (context, next) => {
    const loan = context.current;
    const change = context.input;
    if (loan.status !== "active" || change.status !== "returned" || !isDate(change.returnedAt)) context.fail("Only an active loan with returnedAt may be returned");
    await next();
    const books = context.collection("books", "library");
    const book = books.get(String(loan.bookId));
    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) + 1 });
  },
  delete: async (context, next) => { if (context.current.status === "active") context.fail("Active loans cannot be deleted"); await next(); },
  bulkCreate: async (context) => context.fail("Bulk loans are not allowed")
};
```

## Expected behavior

- A new book begins with all copies available.
- A loan requires an active member, an available book, and a valid future due date.
- Creating a loan reserves one copy; a failed create restores it.
- Returning an active loan releases one copy; active loans cannot be deleted.

## Appendix: curls

The entity endpoint receives the TypeScript module as its JSON `code` string. The local service is already loaded with the complete book, member, and loan modules described above.

```bash
curl http://localhost:3000/v1/entities
curl http://localhost:3000/v1/library/books
curl http://localhost:3000/v1/library/members
curl http://localhost:3000/v1/library/loans

curl -X POST http://localhost:3000/v1/library/loans \
  -H 'content-type: application/json' \
  -d '{"bookId":"<book-id>","memberId":"<member-id>","borrowedAt":"2026-10-12T10:00:00.000Z","dueAt":"2026-10-26T10:00:00.000Z"}'

curl -X PATCH http://localhost:3000/v1/library/loans/<loan-id> \
  -H 'content-type: application/json' \
  -d '{"status":"returned","returnedAt":"2026-10-20T15:30:00.000Z"}'
```

See [runtime TypeScript domain modules](../runtime-code.md) for the exact `code` installation contract.

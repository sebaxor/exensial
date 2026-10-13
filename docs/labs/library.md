# Library circulation runtime lab

This is an independent runtime application: `library/books` owns catalog copies, `library/members` owns membership, and `library/loans` owns circulation. Exensial provides generic CRUD and a neutral collection facade; every rule about copies, members, and loans is installed as library code through `POST /v1/entities`.

## Data definitions

```ts
type Book = {
  /** @exensial.title en Title
   * @exensial.ui.searchable */
  title: string;
  /** @exensial.ui.searchable */ author: string;
  /** @exensial.ui.searchable */ isbn: string;
  /** @exensial.ui.control number */
  copiesTotal: number;
  /** @exensial.title en Available copies */
  /** @exensial.ui.control number */
  copiesAvailable?: number;
}
type Member = {
  /** @exensial.ui.searchable */
  name: string;
  /** @exensial.ui.control email
   * @exensial.ui.searchable */
  email: string;
  active?: boolean;
}
type Loan = {
  /** @exensial.relation library/books label=title */
  book: Book;
  /** @exensial.relation library/members label=name */
  member: Member;
  /** @exensial.ui.control datetime */
  borrowedAt: string;
  /** @exensial.ui.control datetime */
  dueAt: string;
  /** @exensial.ui.control datetime */
  returnedAt?: string;
  /** @exensial.ui.hidden */
  status?: string;
}
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
    delete loan.returnedAt;
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
- Creating a loan reserves one copy, always starts it as `active`, and discards a caller-supplied `returnedAt`; a failed create restores the copy.
- Returning an active loan releases one copy; active loans cannot be deleted.

## Install and reset the lab

The complete executable definition —schemas, JSDoc metadata, TypeScript domain modules, runtime Spanish labels, and fixture data— lives in [install-library-lab.ts](../../scripts/install-library-lab.ts). It resets only the library entities and their `entity.library.*` localization records, then recreates them through the public REST endpoint.

```bash
npm start
npm run lab:library
```

For the same domain with a public book catalog and JWT-protected administration, run `npm run lab:library:permissions`. The users, roles, permission rules, credentials, and policy behavior are documented in [Authentication and endpoint permissions](../security.md).

Pass another local or remote base URL when needed:

```bash
npx tsx scripts/install-library-lab.ts http://localhost:3000
```

After installation, use `/console` for the metadata-driven CRUD UI or `/docs` for Swagger. See [runtime TypeScript domain modules](../runtime-code.md) for the runtime `code` contract.

There are 100 books, so the loan editor demonstrates the advanced relation lookup. Its book search is driven by the optional [ExensialQuery capability](../exensial-query.md), discovered from OpenAPI; it searches the fields marked `@exensial.ui.searchable` rather than loading every book into a select.

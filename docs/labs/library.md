# Library circulation lab

This lab is a complete small application installed through Exensial's REST port. It creates three `library` entities and their domain modules at runtime:

- `books` owns bibliographic data and copy availability.
- `members` owns normalized, active library members.
- `loans` owns borrowing and return transitions.

The executable source of truth is [install-library-lab.ts](../../scripts/install-library-lab.ts). It sends the type definitions, runtime domain code, Spanish localizations, and fixtures through the public API; no library behavior is compiled into Exensial itself.

## Runtime data model

```ts
type Book = {
  /** @exensial.ui.searchable */
  title: string;
  /** @exensial.ui.searchable */
  author: string;
  /** @exensial.ui.searchable */
  isbn: string;
  /** @exensial.ui.control number */
  /** @exensial.default 1 */
  copiesTotal: number;
  /** @exensial.ui.control number */
  /** @exensial.default 1 */
  copiesAvailable?: number;
}

type Member = {
  /** @exensial.ui.searchable */
  name: string;
  /**
   * @exensial.ui.control email
   * @exensial.ui.searchable
   */
  email: string;
  /** @exensial.default true */
  active?: boolean;
}

type Loan = {
  /** @exensial.relation library/books label=title */
  book: Book;
  /** @exensial.relation library/members label=name */
  member: Member;
  /** @exensial.ui.control datetime */
  /** Defaults to the current server time when omitted. */
  borrowedAt?: string;
  /** @exensial.ui.control datetime */
  dueAt: string;
  /** @exensial.ui.control datetime */
  returnedAt?: string;
  /** @exensial.ui.hidden */
  status?: string;
}
```

`book` and `member` are relation fields. The submitted value is the generated surrogate id, but the entity definition remains domain-oriented and the Console displays the book title and member name rather than those ids.

## Business behavior

The installed TypeScript modules deliberately contain only library rules:

- Books trim title, author, and ISBN; ISBN is uppercased. `copiesTotal` must be a positive integer. A new book starts with all copies available, and a total can never fall below copies currently borrowed.
- Members trim names, lowercase email addresses, require a valid email, and become active on creation. A user account can be associated with at most one member; create, update, and bulk import reject duplicate associations.
- A loan requires a real active member, an available book, and a due date later than its borrow date. When `borrowedAt` is omitted, the domain module assigns the current server time. Creating it decrements `copiesAvailable`, forces `status` to `active`, and removes any caller-supplied `returnedAt`. If persistence fails, it restores the reserved copy.
- A return is the only allowed update for an active loan: it must set `status: "returned"` and a valid `returnedAt`; it then releases one copy. Active loans cannot be deleted, and bulk loan creation is rejected.

The relation and copy operations use `context.collection("books", "library")` and `context.collection("members", "library")`, not HTTP or an in-memory repository. The same domain source can therefore survive a later table repository and transaction implementation. Its validation messages are stable localization keys (for example, `library.loans.error.activeCannotDelete`) resolved from the lab's `localizations` records according to `?lang=` or `Accept-Language`.

## Install

Start Exensial, then choose one of the two independent modes:

```bash
npm start

# Library data and domain rules; no library permission policy is installed.
npm run lab:library

# Same domain plus users, roles, JWT permissions, and localized Console labels.
npm run lab:library:permissions
```

Both commands reset the three library definitions, their localized labels, and their fixture records. The protected command additionally resets and recreates the lab's `roles`, `users`, and `permissions`; it first signs in as the existing admin when reinstalling an already protected instance.

Pass another service URL to the executable script when needed:

```bash
npx tsx scripts/install-library-lab.ts http://localhost:3000
npx tsx scripts/install-library-lab.ts --permissions http://localhost:3000
```

The installer creates 100 books, 24 members, and 3 loans (two active and one returned). More than 25 books and members intentionally exercise the paginated advanced relation lookups in the Console.

## Protected mode

`npm run lab:library:permissions` creates these local development identities:

| User | Password | Access |
| --- | --- | --- |
| `reader` | `reader123` | Every `GET` endpoint. |
| `admin` | `admin123` | Reads protected data and performs the administrative writes defined by the lab policy. |
| `ana`, `mateo`, `sofia` | `member123` | Member accounts linked to the three seeded library members. |
| anonymous | — | Public catalog and book-query access. |

Use `/console` for the metadata-driven UI or `/docs` for Swagger. The Console exposes a visible **Sign in** dialog, displays the active username and roles, sends the issued JWT as a Bearer token, and hides resources or CRUD controls that the active principal cannot use. Full policy, JWT, sensitive-field, and OpenAPI metadata details are in [Authentication and endpoint permissions](../security.md).

## Related capabilities

- [Runtime TypeScript domain modules](../runtime-code.md) defines the `context`, `next`, and persistence-neutral collection contract used by this lab.
- [ExensialQuery](../exensial-query.md) documents the optional read capability used by the advanced book lookup.
- [Runtime localization](../localization.md) describes the Spanish labels installed by the script.

# Library circulation lab

This lab is a complete small application installed through Exensial's REST port. It creates three `library` entities and their domain modules at runtime:

- `books` owns bibliographic data and copy availability.
- `members` owns normalized, active library members.
- `loans` owns borrowing and return transitions.

The executable source of truth is [install-library-lab.ts](../../scripts/install-library-lab.ts). It sends the type definitions, runtime domain code, Spanish localizations, and fixtures through the public API; no library behavior is compiled into Exensial itself.

## Entity endpoint payloads

This is the complete domain source sent by the lab to `POST /v1/entities`. The executable installer is still the canonical copy, but the following fragments are intentionally kept in this document so the runtime boundary is auditable without reading Exensial infrastructure.

Each request has this shape; `definition` and `code` below are strings in the actual JSON HTTP payload.

```ts
{
  name: "books" | "members" | "loans",
  version: "1.0.0",
  namespace: "library",
  group: "Library",
  icon: "book,📚", // varies per entity
  definition: "...TypeScript source...",
  code: "...TypeScript domain module..."
}
```

The three calls made by the installer are exactly:

```ts
await request("POST", "/v1/entities", { name: "books", version: "1.0.0", namespace: "library", group: "Library", icon: "book,📚", definition: booksDefinition, code: booksCode });
await request("POST", "/v1/entities", { name: "members", version: "1.0.0", namespace: "library", group: "Library", icon: "users,👥", definition: membersDefinition, code: membersCode });
await request("POST", "/v1/entities", { name: "loans", version: "1.0.0", namespace: "library", group: "Library", icon: "calendar,📅", definition: loansDefinition, code: loansCode });
```

### `books` definition

```ts
/**
 * @exensial.title en Library books
 * @exensial.title es Libros
 * @exensial.description en Catalog records and copy availability for the library.
 * @exensial.operation list en List books
 * @exensial.operation list es Listar libros
 * @exensial.operation create en Create or import books
 * @exensial.operation create es Crear o importar libros
 * @exensial.operation get en Get a book
 * @exensial.operation get es Consultar un libro
 * @exensial.operation replace en Replace a book
 * @exensial.operation replace es Reemplazar un libro
 * @exensial.operation update en Update a book
 * @exensial.operation update es Actualizar un libro
 * @exensial.operation delete en Delete a book
 * @exensial.operation delete es Eliminar un libro
 * @exensial.operation query en Query books
 * @exensial.operation query es Consultar libros
 */
type Book = {
  /** @exensial.title en Title
   * @exensial.title es Título
   * @exensial.description en The title shown to readers.
   * @exensial.ui.searchable */
  title: string;
  /** @exensial.title en Author
   * @exensial.title es Autor
   * @exensial.ui.searchable */
  author: string;
  /** @exensial.title en ISBN
   * @exensial.title es ISBN
   * @exensial.ui.searchable */
  isbn: string;
  /** @exensial.title en Total copies
   * @exensial.title es Total de copias
   * @exensial.ui.control number
   * @exensial.default 1 */
  copiesTotal: number;
  /** @exensial.title en Available copies
   * @exensial.title es Copias disponibles
   * @exensial.ui.control number
   * @exensial.default 1 */
  copiesAvailable?: number;
}
```

### `books` domain module

```ts
function prepare(book, fail) {
  for (const field of ["title", "author", "isbn"]) book[field] = String(book[field] ?? "").trim();
  book.isbn = book.isbn.toUpperCase();
  if (!book.title || !book.author || !book.isbn) fail("library.books.error.requiredFields", "Book title, author, and ISBN are required");
  if (!Number.isInteger(book.copiesTotal) || book.copiesTotal < 1) fail("library.books.error.copiesTotalPositive", "Total copies must be a positive integer");
  book.copiesAvailable = book.copiesTotal;
}
export default {
  create: async (context, next) => { prepare(context.input, context.fail); await next(); },
  bulkCreate: async (context, next) => { for (const book of context.input) prepare(book, context.fail); await next(); },
  update: async (context, next) => {
    const change = context.input, current = context.current;
    for (const field of ["title", "author"]) if (field in change) change[field] = String(change[field]).trim();
    if ("isbn" in change) change.isbn = String(change.isbn).trim().toUpperCase();
    if ("copiesTotal" in change) {
      if (!Number.isInteger(change.copiesTotal) || change.copiesTotal < 1) context.fail("library.books.error.copiesTotalPositive", "Total copies must be a positive integer");
      const borrowed = Number(current.copiesTotal) - Number(current.copiesAvailable);
      if (Number(change.copiesTotal) < borrowed) context.fail("library.books.error.copiesBelowBorrowed", "Total copies cannot be lower than borrowed copies");
      change.copiesAvailable = Number(change.copiesTotal) - borrowed;
    }
    await next();
  }
};
```

### `members` definition

```ts
/**
 * @exensial.title en Library members
 * @exensial.title es Miembros
 * @exensial.description en People who can borrow books from the library.
 * @exensial.operation list en List members
 * @exensial.operation list es Listar miembros
 * @exensial.operation create en Create or import members
 * @exensial.operation create es Crear o importar miembros
 * @exensial.operation get en Get a member
 * @exensial.operation get es Consultar un miembro
 * @exensial.operation replace en Replace a member
 * @exensial.operation replace es Reemplazar un miembro
 * @exensial.operation update en Update a member
 * @exensial.operation update es Actualizar un miembro
 * @exensial.operation delete en Delete a member
 * @exensial.operation delete es Eliminar un miembro
 * @exensial.operation query en Query members
 * @exensial.operation query es Consultar miembros
 */
type Member = {
  /** @exensial.title en Name
   * @exensial.title es Nombre
   * @exensial.ui.searchable */
  name: string;
  /** @exensial.title en Email
   * @exensial.title es Correo electrónico
   * @exensial.ui.control email
   * @exensial.ui.searchable */
  email: string;
  /** @exensial.title en User account
   * @exensial.title es Cuenta de usuario
   * @exensial.relation users label=username */
  user?: User;
  /** @exensial.title en Active
   * @exensial.title es Activo
   * @exensial.default true */
  active?: boolean;
}
```

### `members` domain module

```ts
function assertUserIsAvailable(member, currentId, members, fail) {
  if (!member.user) return;
  const assigned = members.findBy("user", String(member.user)).find((other) => other.id !== currentId);
  if (assigned) fail("library.members.error.userAlreadyAssigned", "A user can be associated with only one member");
}
function prepare(member, fail) {
  member.name = String(member.name ?? "").trim();
  member.email = String(member.email ?? "").trim().toLowerCase();
  if (!member.name || !member.email.includes("@")) fail("library.members.error.requiredFields", "A name and valid email are required");
  member.active = true;
}
export default {
  create: async (context, next) => { prepare(context.input, context.fail); assertUserIsAvailable(context.input, undefined, context.collection("members", "library"), context.fail); await next(); },
  bulkCreate: async (context, next) => {
    const users = new Set();
    for (const member of context.input) {
      prepare(member, context.fail);
      assertUserIsAvailable(member, undefined, context.collection("members", "library"), context.fail);
      if (member.user && users.has(String(member.user))) context.fail("library.members.error.userAlreadyAssigned", "A user can be associated with only one member");
      if (member.user) users.add(String(member.user));
    }
    await next();
  },
  update: async (context, next) => {
    const member = context.input;
    if ("name" in member) member.name = String(member.name).trim();
    if ("email" in member) { member.email = String(member.email).trim().toLowerCase(); if (!member.email.includes("@")) context.fail("library.members.error.validEmail", "A valid email is required"); }
    if ("user" in member) assertUserIsAvailable(member, context.current.id, context.collection("members", "library"), context.fail);
    await next();
  }
};
```

### `loans` definition

```ts
/**
 * @exensial.title en Book loans
 * @exensial.title es Préstamos
 * @exensial.description en Circulation records for borrowed and returned books.
 * @exensial.operation list en List loans
 * @exensial.operation list es Listar préstamos
 * @exensial.operation create en Create or import loans
 * @exensial.operation create es Crear o importar préstamos
 * @exensial.operation get en Get a loan
 * @exensial.operation get es Consultar un préstamo
 * @exensial.operation replace en Replace a loan
 * @exensial.operation replace es Reemplazar un préstamo
 * @exensial.operation update en Update a loan
 * @exensial.operation update es Actualizar un préstamo
 * @exensial.operation delete en Delete a loan
 * @exensial.operation delete es Eliminar un préstamo
 * @exensial.operation query en Query loans
 * @exensial.operation query es Consultar préstamos
 */
type Loan = {
  /** @exensial.title en Book
   * @exensial.title es Libro
   * @exensial.relation library/books label=title */
  book: Book;
  /** @exensial.title en Member
   * @exensial.title es Miembro
   * @exensial.relation library/members label=name */
  member: Member;
  /** @exensial.title en Borrowed at
   * @exensial.title es Fecha de préstamo
   * @exensial.description en Defaults to the current server time when omitted.
   * @exensial.description es Usa la hora actual del servidor cuando se omite.
   * @exensial.ui.control datetime */
  borrowedAt?: string;
  /** @exensial.title en Due at
   * @exensial.title es Fecha límite
   * @exensial.ui.control datetime */
  dueAt: string;
  /** @exensial.title en Returned at
   * @exensial.title es Fecha de devolución
   * @exensial.ui.control datetime */
  returnedAt?: string;
  /** @exensial.ui.hidden */
  status?: string;
}
```

### `loans` domain module

```ts
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
export default {
  create: async (context, next) => {
    const loan = context.input;
    if (!String(loan.borrowedAt ?? "").trim()) loan.borrowedAt = new Date().toISOString();
    for (const field of ["book", "member", "dueAt"]) if (!String(loan[field] ?? "").trim()) context.fail("library.loans.error.requiredFields", "Book, member, and due date are required");
    const books = context.collection("books", "library"), members = context.collection("members", "library");
    const book = books.get(String(loan.book)), member = members.get(String(loan.member));
    if (!member?.active) context.fail("library.loans.error.memberInactive", "Member is not active");
    if (!book || Number(book.copiesAvailable) < 1) context.fail("library.loans.error.bookUnavailable", "Book is not available");
    if (!isDate(loan.borrowedAt) || !isDate(loan.dueAt) || Date.parse(loan.dueAt) <= Date.parse(loan.borrowedAt)) context.fail("library.loans.error.dueDate", "Due date must be later than the borrowed date");
    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 });
    try { delete loan.returnedAt; loan.status = "active"; await next(); }
    catch (error) { await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) }); throw error; }
  },
  update: async (context, next) => {
    const loan = context.current, change = context.input;
    if (loan.status !== "active" || change.status !== "returned" || !isDate(change.returnedAt)) context.fail("library.loans.error.returnActiveLoan", "Only an active loan with a returned date may be returned");
    await next();
    const books = context.collection("books", "library"), book = books.get(String(loan.book));
    const available = Number(book.copiesAvailable) + 1;
    if (available > Number(book.copiesTotal)) context.fail("library.loans.error.availableAboveTotal", "Available copies cannot exceed total copies");
    await books.update(book.id, { copiesAvailable: available });
  },
  delete: async (context, next) => { if (context.current.status === "active") context.fail("library.loans.error.activeCannotDelete", "Active loans cannot be deleted"); await next(); },
  bulkCreate: async (context) => context.fail("library.loans.error.bulkCreate", "Bulk loan creation is not allowed")
};
```

`book`, `member`, and `user` are relation fields. Their submitted values are surrogate ids, but the type definitions stay domain-oriented and the Console resolves them to book titles, member names, and usernames. The modules use `context.collection`, `findBy`, and `context.fail`; they do not use HTTP, a concrete repository, or an in-memory implementation.

## Rules encoded by the endpoint payloads

- Books trim title, author, and ISBN; normalize ISBN to uppercase; require a positive copy total; and prevent reducing the total below the copies already loaned.
- Members trim names, normalize email to lowercase, start active, require a valid email, and allow each user account to be related to only one member—including within a bulk import.
- Loans default `borrowedAt` on the server, require an active member and an available copy, reserve and restore copies around persistence, forbid caller-provided return dates on creation, and only allow an active loan to transition to `returned` with a valid return date.
- Every business rejection is emitted with a stable localization key. The library installer sends its English and Spanish text through `POST /v1/localizations`; these localization records are deliberately separate from the three entity requests above.

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

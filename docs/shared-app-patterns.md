# Shared authenticated-app patterns

The copyable catalogue is available at `/app/padroes` and linked from `/app`.
It is intentionally `noindex` and contains synthetic demonstration data only.
The catalogue composes shared components without importing any business feature
module.

## Canonical examples

- `src/components/data-table/examples/server-data-table-example.tsx` — server
  pagination/sorting inputs, URL-owned facets, column visibility, bulk
  selection, and explicit ready/loading/empty/error states.
- `src/components/forms/examples/customer-form-example.tsx` — TanStack Form +
  Zod validation, a focusable error summary, native keyboard-operable combobox
  and date controls, and specialized pt-BR inputs.
- `src/components/patterns/examples/presentation-patterns-example.tsx` — safe
  confirmation behavior, typed status badges, and geometry-matched skeletons.
- `src/components/patterns/examples/shared-patterns-example.tsx` — the
  discoverable composition, including the authenticated `AppQueryProvider`
  boundary and semantic page header.

Route modules should pass their validated search object and a small adapter for
TanStack Router's `navigate` function to the table example. The serialized
page, page size, sort, and facet state is the request input for the route's
TanStack Query/server-function layer. Defaults are omitted from the URL.

## Maintained dependencies

- `@tanstack/react-query` — request-scoped Query client/provider and typed
  server-state defaults.
- `@tanstack/react-table` — controlled server pagination, sorting, filtering,
  visibility, and row selection.
- `@tanstack/react-form` and `zod` — typed form state and validation contracts.
- `brazilian-values` — maintained CPF/CNPJ/CEP/phone formatting and CNPJ
  validation.
- Radix/shadcn source primitives — accessible dialog, menu, select, checkbox,
  and presentation behavior while retaining project-owned styling tokens.

No dependency was added by the catalogue integration itself; these packages
were introduced by the owning shared-pattern tasks. Do not replace them with a
second widget kit or a generic application framework.

## Verification contract

Before copying a pattern into a feature, verify keyboard tab order, focus
return after dialog cancellation, Escape behavior, native combobox operation,
error-summary links, table sorting/facets/visibility/selection, and all request
states. Shared examples and components must use complete static Tailwind class
strings; never construct utility names dynamically.
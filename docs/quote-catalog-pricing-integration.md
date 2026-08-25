# Quote catalog and pricing client integration

The shared client contract lives in `src/features/app/quotes/quote-data.ts`. UI consumers inject a `QuoteDataService`; the module supplies typed TanStack Query options, immutable snapshot helpers, current-source comparison, and discriminated UI states.

## Transport shape and Decimal boundary

All quantities, prices, rates, totals, and version tokens cross the client boundary as base-10 strings. Consumers must not call `Number`, `parseFloat`, `Math.round`, or otherwise coerce them to IEEE-754 values. Use `decimal.js` only for client-side comparison or clearly labelled previews. Values returned by `recalculateQuote` are authoritative and must be rendered unchanged.

`searchCatalog` is one server-paginated request containing:

- the selected price-list ID;
- search plus industry, brand, and category facets;
- products already joined to their applicable selected-list price;
- facet counts, available price lists, the configured default, and cursor metadata.

`loadQuotePricing` is one aggregate request containing every saved line and its optional current product/price source. A consumer must not replace it with one product or price request per line. Saved description, unit, quantity, price, discount, and tax snapshots remain the rendering source. `mergeSavedLineWithCurrentSource` adds `current`, `sourceStatus`, and `changes` without mutating those snapshots. Missing or archived current products remain renderable from saved data but are not eligible for new selection.

## Query keys

All keys are produced by `quoteDataKeys`:

| Factory | Shape | Use |
| --- | --- | --- |
| `all` | `['quote-data']` | invalidate every quote-data cache only when absolutely required |
| `catalogs()` | `['quote-data', 'catalog']` | invalidate all catalog pages and facets |
| `catalog(request)` | catalogs prefix + normalized request | one page/filter/price-list selection; unordered facet arrays are sorted for stable identity |
| `quotes()` | `['quote-data', 'quote']` | invalidate every loaded quote pricing model |
| `quote(id)` | quotes prefix + quote ID | one quote, its snapshots, and batched current sources |

Changing `priceListId` always creates a different catalog key. Cursor, search text, facets, and page size also participate in the key.

## Mutation invalidation

`quoteRecalculationMutationOptions` invalidates the recalculated `quote(id)` and all `catalogs()` after success. This refreshes the optimistic-concurrency version and current source prices without rewriting local saved snapshots. Failed validation, network, and conflict responses do not invalidate or discard user edits.

## Consumer states

Use `toCatalogState` for `loading`, `empty`, `ready`, and `error`. Use `toRecalculationState` for `idle`, `loading`, `success`, `error`, and the separate `conflict` state. A conflict includes the server's current opaque version token when supplied; keep the user's draft in place and offer an explicit reload/reconcile action.

Archived catalog rows should be labelled unavailable and passed through `createLineSnapshotFromCatalog`, which rejects archived products and products without a selected-list price. Existing archived lines bypass new-selection logic and remain readable through their saved snapshots.

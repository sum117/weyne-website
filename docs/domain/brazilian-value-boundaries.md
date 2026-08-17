# Brazilian identifier validation boundary

Status: accepted for the shared domain primitives

Library: [`brazilian-values`](https://github.com/VitorLuizC/brazilian-values) `^0.14.0`

License: MIT

## Decision

Use `brazilian-values` for CNPJ check digits, CEP shape validation, Brazilian phone/DDD validation, and identifier display formatting. Version 0.14.0 was published in July 2026, ships TypeScript declarations and ESM/CJS exports, and supports the alphanumeric CNPJ format. Keeping these algorithms in this maintained dependency avoids creating a second, locally maintained interpretation of Brazilian rules.

The application wrapper in `src/domain/primitives/brazilian.ts` deliberately owns only the storage/display boundary:

| Value | Accepted input | Canonical domain output | pt-BR display |
|---|---|---|---|
| CNPJ | 14 canonical characters or `AA.AAA.AAA/AAAA-DV` | 12 uppercase alphanumeric base characters plus 2 numeric check digits | `AA.AAA.AAA/AAAA-DV` |
| CEP | 8 digits or `NNNNN-NNN` | 8 digits | `NNNNN-NNN` |
| Phone | 10/11 national digits, `(DD) NNNN-NNNN`, `(DD) NNNNN-NNNN`, optionally prefixed by `+55 ` | 10/11 national digits (`DDD` plus subscriber number) | `(DD) NNNN-NNNN` or `(DD) NNNNN-NNNN` |

Wrapper grammar is intentionally exact. It rejects surrounding whitespace, partial masks, arbitrary punctuation, and other malformed locale strings before canonicalization. The library remains the authority for CNPJ check digits and Brazilian phone/DDD rules. CEP validation confirms the canonical Brazilian format; it does not claim that an address currently exists.

Calendar dates are separate from the identifier library. `src/domain/primitives/date.ts` persists exact `YYYY-MM-DD` calendar dates and provides explicit `DD/MM/YYYY` parse/display helpers, so no locale-formatted date or time-zone-bearing `Date` enters the domain representation.

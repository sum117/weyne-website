/**
 * PostgreSQL `LIKE`/`ILIKE` pattern helpers.
 *
 * A caller-supplied filter value is data, never pattern syntax. Interpolating
 * it straight into `%${value}%` lets `%` and `_` act as wildcards, so a search
 * for `%` matches every row and `a_c` matches `abc`. Drizzle parameterizes the
 * pattern, so this is not SQL injection — it is a correctness and
 * index/cost defect. Escape the value first, then add the wildcards you meant.
 *
 * The escape character is a backslash, which is PostgreSQL's `LIKE` default,
 * so no `ESCAPE` clause is required.
 */

const LIKE_METACHARACTERS = /[\\%_]/g

/** Escapes `\`, `%`, and `_` so the value matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(LIKE_METACHARACTERS, (character) => `\\${character}`)
}

/** Builds a literal "contains" pattern: `%<escaped value>%`. */
export function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`
}

/** Builds a literal "starts with" pattern: `<escaped value>%`. */
export function startsWithPattern(value: string): string {
  return `${escapeLikePattern(value)}%`
}

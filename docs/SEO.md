# SEO launch checklist

Production origin: **https://weynerepresentacoes.com.br** (apex; `www` should
301 → apex at Cloudflare).

## Already shipped (in the build)

- ✅ `<title>` + meta description (pt-BR)
- ✅ Canonical `<link>` → apex
- ✅ Open Graph + Twitter cards, with an HTML-rendered OG image (`/og/weyne-home.jpg`)
- ✅ `Organization` + `ProfessionalService` JSON-LD (name, founder, WhatsApp, e-mail, states served)
- ✅ `sitemap.xml` + `robots.txt` (reference the origin)
- ✅ Prerendered semantic HTML, `lang="pt-BR"`, responsive, fast

## What I need to finish SEO (owner action)

| # | Item | Why | How |
|---|---|---|---|
| 1 | **Google Search Console** access or a **DNS TXT** verification token | Own the property, see indexing/coverage | Either add me/you as owner, or paste the `google-site-verification` TXT value — I can add the DNS record via Cloudflare once the API token is unblocked (see below), or you add it in the dashboard |
| 2 | Confirm apex vs `www` as canonical | Avoid duplicate-content split | Default chosen: **apex**. Say the word to flip it |
| 3 | **CNPJ** (or "omit") | Adds `taxID` to JSON-LD + trust in footer | Provide the number, or approve omitting it |
| 4 | **Instagram / LinkedIn** URLs (or "omit") | `sameAs` links + social icons | Provide URLs, or approve omitting |
| 5 | **Business address** (or "regions only") | Enables full `LocalBusiness` + Google Business Profile | Provide street/city, or confirm service-area-only |
| 6 | **Google Business Profile** (Perfil da Empresa) | Strongest lever for local BR search | Create/claim it (I can't); list the 4 states as service area |

## Verification &amp; submission steps (once #1 is available)

1. Verify the property in Search Console (DNS TXT is cleanest for an apex).
2. Submit `https://weynerepresentacoes.com.br/sitemap.xml`.
3. Request indexing for `/`.
4. Validate structured data with the [Rich Results Test](https://search.google.com/test/rich-results) and [Schema Markup Validator](https://validator.schema.org/).
5. (Optional) Repeat verification + sitemap on **Bing Webmaster Tools**.

## Note on the Cloudflare API token

`CLOUDFLARE_ACCOUNT_API_TOKEN` is currently **IP-restricted** and rejected from
both this workstation and the VPS (`error 9109`). To let automation manage DNS
(incl. the Search Console TXT record) and the tunnel, add the **VPS IP
`15.235.16.147`** to the token's *Client IP Address Filtering* allowlist — or
remove the restriction. See `docs/design-handoff/` for architecture context.

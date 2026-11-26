# Naming

The public name and domain are the owner's decision. This file records it.

Chosen name: TallyDesk
Domain: tallydesk.pages.dev

## The rule

- The public name and the domain avoid the M-Pesa trademark: no "M-Pesa", "MPESA", "M Pesa" or
  similar, in any case or spacing. "M-PESA" may still appear where the app describes what it
  reads ("Read an M-PESA statement"), never as the app's own name.
- The README and the Welcome screen say the app is not affiliated with Safaricom, in one line:
  "TallyDesk is an independent tool and is not affiliated with or endorsed by Safaricom or
  M-Pesa." The footer carries no disclaimer.
- The name the app shows is the chosen name, set once in `web/src/content/brand.ts` (`APP_NAME`)
  and imported everywhere it is shown: the page title (`web/src/app/layout.tsx`), the web manifest
  (`web/src/app/manifest.ts`), both headers, the footer, the Welcome screen's disclaimer, and the
  service worker's cache name (`tallydesk-<version>`, through the generated allow-list).

`tools/release/check_naming.py` checks all three and runs in the release workflow before
anything is deployed, so a version tag cannot deploy until the name is chosen.

## Names in use today

| Where | Name |
|---|---|
| Page title, web manifest, headers, footer, README title | TallyDesk (from `brand.ts`) |
| Repository, package names, the vault's database name | mpesa-analytics, mpesa-core, mpesa-analytics-vault |

The repository and package names are not public-facing. The vault's database keeps its name, so a
remembered statement saved before the rename still opens. "Sovereign Ledger" is the name of the
design system the styles come from (`web/src/app/globals.css`), never shown in the app.

## The mark

Three rising bars in on-primary `#ffffff` on primary `#065f46`, the palette's own tokens
(`web/src/app/globals.css`): `web/public/icon.svg`, and `icon-maskable.svg` for the full-bleed
form. `web/scripts/build_app_icons.mjs` writes the PNGs (192, 512, maskable 512, apple-touch 180)
and `favicon.ico` from them; both headers draw the same bars (`components/brand-mark.tsx`).

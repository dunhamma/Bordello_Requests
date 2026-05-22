# Bordello Armor Catalog

This workspace contains a maintainable armor catalog for The Modding Bordello modlists.

## Files

- `data/armor-catalog.csv` is the editable source of truth.
- `site/armor-catalog.json` is the structured website artifact.
- `site/armor-catalog.html` is a standalone publishable catalog page.
- `scripts/build-armor-catalog.mjs` refreshes candidates from public load-order pages, validates the CSV, and regenerates the website artifacts.

## Update Workflow

1. Run `node scripts/build-armor-catalog.mjs --refresh` after a major modlist update.
2. Edit `data/armor-catalog.csv` to curate user-facing rows:
   - Set `armor_weight_tier` to `Clothing`, `Light`, `Heavy`, `Mixed`, or `Unknown`.
   - Paste a Nexus screenshot URL into `image_url` when available.
   - Keep patch/conversion/fix rows as non-catalog entries unless they should be shown.
3. Run `node scripts/build-armor-catalog.mjs --build`.
4. Publish `site/armor-catalog.json` and `site/armor-catalog.html`, or copy the HTML into the site.

To preview locally:

```powershell
node scripts/serve-site.mjs 4173
```

Then open `http://127.0.0.1:4173/`.

## Nexus Images

The public page does not make Nexus API calls. Image URLs are stored in the CSV and copied into the generated JSON/HTML.

For private build-time enrichment, set `NEXUS_API_KEY` and run:

```powershell
node scripts/build-armor-catalog.mjs --enrich-nexus --build
```

That optional step uses Nexus metadata as a fallback when `image_url` is blank. Curated screenshot URLs should still be preferred when selecting the second or best representative image from a Nexus page.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SITE_DIR = path.join(ROOT, "site");
const CSV_PATH = path.join(DATA_DIR, "armor-catalog.csv");
const JSON_PATH = path.join(SITE_DIR, "armor-catalog.json");
const HTML_PATH = path.join(SITE_DIR, "armor-catalog.html");

const COLUMNS = [
  "catalog_id",
  "display_name",
  "canonical_mod_name",
  "armor_weight_tier",
  "nexus_url",
  "nexus_game_domain",
  "nexus_mod_id",
  "image_url",
  "image_source_url",
  "image_rank",
  "included_in_modlists",
  "source_sections",
  "source_versions",
  "entry_type",
  "status",
  "notes",
  "last_verified"
];

const MODLISTS = [
  { slug: "joj", label: "JOJ", name: "Journals of Jyggalag" },
  { slug: "tot", label: "TOT", name: "Tomes of Talos" },
  { slug: "hoh", label: "HOH", name: "Hymns of Hircine" },
  { slug: "mom", label: "MOM", name: "Mantras of Mara" },
  { slug: "dod", label: "DOD", name: "Diaries of Dibella" },
  { slug: "vov", label: "VOV", name: "Visions of Vaermina" }
];

const WEIGHT_TIERS = new Set(["Clothing", "Light", "Heavy", "Mixed", "Unknown"]);
const ENTRY_TYPES = new Set([
  "Catalog Item",
  "Patch",
  "Bodyslide/Body Conversion",
  "Distribution",
  "Fix",
  "Dependency"
]);
const STATUSES = new Set(["Needs URL", "Needs Weight", "Needs Image", "Ready", "Deprecated"]);

const args = new Set(process.argv.slice(2));
const shouldRefresh = args.has("--refresh");
const shouldBuild = args.has("--build") || shouldRefresh || args.has("--enrich-nexus");
const shouldEnrichNexus = args.has("--enrich-nexus");

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(SITE_DIR, { recursive: true });

let rows = await readExistingRows();

if (shouldRefresh) {
  const extracted = await extractAllModlists();
  rows = mergeRows(rows, extracted);
  await writeCsv(CSV_PATH, rows);
  console.log(`Refreshed ${rows.length} source rows into ${relative(CSV_PATH)}.`);
}

if (shouldEnrichNexus) {
  rows = await enrichRowsWithNexusMetadata(rows);
  await writeCsv(CSV_PATH, rows);
}

if (shouldBuild) {
  const validation = validateRows(rows);
  await writeJson(JSON_PATH, rows, validation);
  await writeHtml(HTML_PATH, rows, validation);
  printValidation(validation);
  console.log(`Built ${relative(JSON_PATH)} and ${relative(HTML_PATH)}.`);
}

if (!shouldRefresh && !shouldBuild && !shouldEnrichNexus) {
  console.log("Usage: npm run refresh | npm run build | npm run enrich:nexus");
}

async function readExistingRows() {
  try {
    const csv = await fs.readFile(CSV_PATH, "utf8");
    return parseCsv(csv).map(normalizeRow);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function extractAllModlists() {
  const allRows = [];
  for (const modlist of MODLISTS) {
    const url = `https://www.themoddingbordello.com/modlists/${modlist.slug}/load-order`;
    console.log(`Fetching ${modlist.label} load order...`);
    const html = await fetchText(url);
    const sections = extractSections(html);
    const armorSections = sections.filter((section) => isArmorSection(section.title));
    for (const section of armorSections) {
      for (const mod of section.mods) {
        if (String(mod.enabled).toLowerCase() !== "true") continue;
        const nexus = parseNexusUrl(mod.nexusUrl);
        const canonical = String(mod.name || "").trim();
        if (!canonical) continue;
        const entryType = classifyEntry(canonical, section.title);
        allRows.push(normalizeRow({
          catalog_id: buildCatalogId(canonical, nexus),
          display_name: cleanDisplayName(canonical),
          canonical_mod_name: canonical,
          armor_weight_tier: "Unknown",
          nexus_url: nexus.url,
          nexus_game_domain: nexus.gameDomain,
          nexus_mod_id: nexus.modId,
          image_url: "",
          image_source_url: "",
          image_rank: "",
          included_in_modlists: modlist.label,
          source_sections: `${modlist.label}: ${section.title}`,
          source_versions: `${modlist.label}: ${mod.version || ""}`.trim(),
          entry_type: entryType,
          status: initialStatus(entryType, nexus.url, "", "Unknown"),
          notes: defaultNotes(entryType),
          last_verified: todayIso()
        }));
      }
    }
  }
  return allRows;
}

function extractSections(html) {
  const decoded = decodeRscEscapes(html);
  const sections = [];
  const marker = '"kind":"section","mods":[';
  let index = 0;
  while ((index = decoded.indexOf(marker, index)) !== -1) {
    const objectStart = decoded.lastIndexOf('{"id":"', index);
    if (objectStart === -1) {
      index += marker.length;
      continue;
    }
    const objectEnd = findBalancedJsonEnd(decoded, objectStart);
    if (objectEnd === -1) {
      index += marker.length;
      continue;
    }
    const jsonText = decoded.slice(objectStart, objectEnd + 1);
    try {
      const section = JSON.parse(jsonText);
      if (section?.title && Array.isArray(section.mods)) {
        sections.push(section);
      }
    } catch {
      // Ignore partial RSC fragments and keep scanning.
    }
    index = objectEnd + 1;
  }
  return dedupeSections(sections);
}

function decodeRscEscapes(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0027/g, "'");
}

function findBalancedJsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function dedupeSections(sections) {
  const seen = new Set();
  const deduped = [];
  for (const section of sections) {
    const key = `${section.id}|${section.title}|${section.mods.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(section);
  }
  return deduped;
}

function isArmorSection(title) {
  return /armor|armour|clothing|outfit|robe|vanilla replacers|sos armor/i.test(title);
}

function classifyEntry(name, sectionTitle) {
  const text = `${name} ${sectionTitle}`.toLowerCase();
  if (/\b(distribution|distributor|spid|kid|leveled list|levelled list)\b/.test(text)) {
    return "Distribution";
  }
  if (/\b(bodyslide|body slide|3ba|cbbe|himbo|bhunp|uunp|unp|7base|conversion|refit)\b/.test(text)) {
    return "Bodyslide/Body Conversion";
  }
  if (/\b(patch|patched|compatibility|compat|addon patch|esl|espfe)\b/.test(text)) {
    return "Patch";
  }
  if (/\b(fix|fixes|fixed|hotfix|bugfix|bugfixes)\b/.test(text)) {
    return "Fix";
  }
  if (/\b(resource|framework|requirement|dependency|assets only|core files)\b/.test(text)) {
    return "Dependency";
  }
  return "Catalog Item";
}

function cleanDisplayName(name) {
  return name
    .replace(/\s+-\s+SE-AE$/i, "")
    .replace(/\s+-\s+SSE$/i, "")
    .replace(/\s+SE$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNexusUrl(value) {
  const url = value && value !== "$undefined" ? String(value).trim() : "";
  const match = url.match(/nexusmods\.com\/([^/]+)\/mods\/(\d+)/i);
  return {
    url,
    gameDomain: match?.[1]?.toLowerCase() || "",
    modId: match?.[2] || ""
  };
}

function buildCatalogId(name, nexus) {
  if (nexus.gameDomain && nexus.modId) return `${nexus.gameDomain}-${nexus.modId}`;
  return slugify(name);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function mergeRows(existingRows, extractedRows) {
  const byId = new Map();
  for (const row of existingRows) {
    byId.set(row.catalog_id, normalizeRow(row));
  }
  for (const extracted of extractedRows) {
    const existing = byId.get(extracted.catalog_id);
    if (!existing) {
      byId.set(extracted.catalog_id, extracted);
      continue;
    }
    const canUpdateAutoClassification =
      !existing.image_url
      && existing.armor_weight_tier === "Unknown"
      && (existing.notes === "" || existing.notes === defaultNotes(existing.entry_type));
    const merged = normalizeRow({
      ...existing,
      display_name: existing.display_name || extracted.display_name,
      canonical_mod_name: existing.canonical_mod_name || extracted.canonical_mod_name,
      nexus_url: existing.nexus_url || extracted.nexus_url,
      nexus_game_domain: existing.nexus_game_domain || extracted.nexus_game_domain,
      nexus_mod_id: existing.nexus_mod_id || extracted.nexus_mod_id,
      included_in_modlists: mergeListField(existing.included_in_modlists, extracted.included_in_modlists),
      source_sections: mergeListField(existing.source_sections, extracted.source_sections),
      source_versions: mergeListField(existing.source_versions, extracted.source_versions),
      entry_type: canUpdateAutoClassification ? extracted.entry_type : existing.entry_type,
      last_verified: todayIso()
    });
    merged.notes = canUpdateAutoClassification ? defaultNotes(merged.entry_type) : merged.notes;
    merged.status = recomputeStatus(merged);
    byId.set(extracted.catalog_id, merged);
  }
  return [...byId.values()].sort(compareRows);
}

function mergeListField(left, right) {
  const values = new Set();
  for (const item of `${left || ""};${right || ""}`.split(";")) {
    const trimmed = item.trim();
    if (trimmed) values.add(trimmed);
  }
  return [...values].join("; ");
}

function compareRows(a, b) {
  const publicDelta = Number(b.entry_type === "Catalog Item") - Number(a.entry_type === "Catalog Item");
  if (publicDelta) return publicDelta;
  return a.display_name.localeCompare(b.display_name);
}

function initialStatus(entryType, nexusUrl, imageUrl, weightTier) {
  if (!nexusUrl) return "Needs URL";
  if (entryType === "Catalog Item" && weightTier === "Unknown") return "Needs Weight";
  if (entryType === "Catalog Item" && !imageUrl) return "Needs Image";
  return "Ready";
}

function recomputeStatus(row) {
  if (row.status === "Deprecated") return "Deprecated";
  return initialStatus(row.entry_type, row.nexus_url, row.image_url, row.armor_weight_tier);
}

function defaultNotes(entryType) {
  if (entryType === "Catalog Item") return "";
  return "Excluded from public catalog by default; keep for traceability.";
}

function normalizeRow(row) {
  const normalized = {};
  for (const column of COLUMNS) normalized[column] = String(row[column] ?? "").trim();
  normalized.armor_weight_tier = WEIGHT_TIERS.has(normalized.armor_weight_tier) ? normalized.armor_weight_tier : "Unknown";
  normalized.entry_type = ENTRY_TYPES.has(normalized.entry_type) ? normalized.entry_type : "Catalog Item";
  normalized.status = STATUSES.has(normalized.status) ? normalized.status : recomputeStatus(normalized);
  if (!normalized.last_verified) normalized.last_verified = todayIso();
  return normalized;
}

async function enrichRowsWithNexusMetadata(sourceRows) {
  const apiKey = process.env.NEXUS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXUS_API_KEY is required for --enrich-nexus.");
  }
  const enriched = [];
  for (const row of sourceRows) {
    if (row.image_url || !row.nexus_game_domain || !row.nexus_mod_id) {
      enriched.push(row);
      continue;
    }
    try {
      const metadata = await fetchNexusModMetadata(apiKey, row.nexus_game_domain, row.nexus_mod_id);
      const image = metadata.picture_url || metadata.thumbnail_url || "";
      enriched.push(normalizeRow({
        ...row,
        image_url: image,
        image_source_url: image ? row.nexus_url : row.image_source_url,
        image_rank: image ? "primary-metadata" : row.image_rank,
        status: initialStatus(row.entry_type, row.nexus_url, image, row.armor_weight_tier),
        last_verified: todayIso()
      }));
      await delay(250);
    } catch (error) {
      console.warn(`Nexus enrichment failed for ${row.display_name}: ${error.message}`);
      enriched.push(row);
    }
  }
  return enriched;
}

async function fetchNexusModMetadata(apiKey, gameDomain, modId) {
  const response = await fetch(`https://api.nexusmods.com/v1/games/${gameDomain}/mods/${modId}.json`, {
    headers: {
      apikey: apiKey,
      "Application-Name": "Bordello Armor Catalog Builder",
      "Application-Version": "1.0.0"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function validateRows(sourceRows) {
  const ids = new Map();
  const issues = [];
  const publicRows = sourceRows.filter((row) => row.entry_type === "Catalog Item" && row.status !== "Deprecated");
  for (const [index, row] of sourceRows.entries()) {
    const rowNumber = index + 2;
    if (!row.catalog_id) issues.push({ rowNumber, level: "error", message: "Missing catalog_id." });
    if (ids.has(row.catalog_id)) issues.push({ rowNumber, level: "error", message: `Duplicate catalog_id also used on row ${ids.get(row.catalog_id)}.` });
    ids.set(row.catalog_id, rowNumber);
    if (!WEIGHT_TIERS.has(row.armor_weight_tier)) issues.push({ rowNumber, level: "error", message: `Invalid armor_weight_tier: ${row.armor_weight_tier}.` });
    if (!ENTRY_TYPES.has(row.entry_type)) issues.push({ rowNumber, level: "error", message: `Invalid entry_type: ${row.entry_type}.` });
    if (!STATUSES.has(row.status)) issues.push({ rowNumber, level: "error", message: `Invalid status: ${row.status}.` });
    if (row.entry_type === "Catalog Item" && row.status !== "Deprecated") {
      if (!row.display_name) issues.push({ rowNumber, level: "error", message: "Public row is missing display_name." });
      if (!row.nexus_url) issues.push({ rowNumber, level: "warning", message: "Public row is missing nexus_url." });
      if (!row.image_url) issues.push({ rowNumber, level: "warning", message: "Public row is missing image_url." });
      if (row.armor_weight_tier === "Unknown") issues.push({ rowNumber, level: "warning", message: "Public row still has Unknown weight tier." });
      if (!row.included_in_modlists) issues.push({ rowNumber, level: "warning", message: "Public row is missing included_in_modlists." });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    totalRows: sourceRows.length,
    publicRows: publicRows.length,
    readyPublicRows: publicRows.filter((row) => row.status === "Ready").length,
    missingImages: publicRows.filter((row) => !row.image_url).length,
    unknownWeights: publicRows.filter((row) => row.armor_weight_tier === "Unknown").length,
    needsUrl: publicRows.filter((row) => !row.nexus_url).length,
    nonPublicRows: sourceRows.length - publicRows.length,
    issues
  };
}

async function writeJson(filePath, sourceRows, validation) {
  const payload = {
    generatedAt: validation.generatedAt,
    source: "data/armor-catalog.csv",
    modlists: MODLISTS,
    validation: {
      totalRows: validation.totalRows,
      publicRows: validation.publicRows,
      readyPublicRows: validation.readyPublicRows,
      missingImages: validation.missingImages,
      unknownWeights: validation.unknownWeights,
      needsUrl: validation.needsUrl
    },
    entries: sourceRows
      .filter((row) => row.entry_type === "Catalog Item" && row.status !== "Deprecated")
      .map((row) => ({
        catalogId: row.catalog_id,
        displayName: row.display_name,
        canonicalModName: row.canonical_mod_name,
        armorWeightTier: row.armor_weight_tier,
        nexusUrl: row.nexus_url,
        nexusGameDomain: row.nexus_game_domain,
        nexusModId: row.nexus_mod_id,
        imageUrl: row.image_url,
        imageSourceUrl: row.image_source_url,
        imageRank: row.image_rank,
        includedInModlists: splitList(row.included_in_modlists),
        sourceSections: splitList(row.source_sections),
        sourceVersions: splitList(row.source_versions),
        status: row.status,
        notes: row.notes,
        lastVerified: row.last_verified
      }))
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeHtml(filePath, sourceRows, validation) {
  const publicRows = sourceRows.filter((row) => row.entry_type === "Catalog Item" && row.status !== "Deprecated");
  const entries = publicRows.map((row) => ({
    id: row.catalog_id,
    name: row.display_name,
    canonicalName: row.canonical_mod_name,
    tier: row.armor_weight_tier,
    nexusUrl: row.nexus_url,
    imageUrl: row.image_url,
    imageSourceUrl: row.image_source_url,
    imageRank: row.image_rank,
    modlists: splitList(row.included_in_modlists),
    status: row.status,
    notes: row.notes
  }));
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Modding Bordello Armor Catalog</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #12100f;
      --panel: #1d1917;
      --panel-2: #26211e;
      --ink: #f3eee9;
      --muted: #b7aaa1;
      --line: #473934;
      --accent: #a9342c;
      --accent-2: #d7a94b;
      --good: #7db88f;
      --warn: #e0b95e;
      --bad: #d87972;
      --chip: #332b27;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    a { color: inherit; }
    .catalog-shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 18px 42px;
    }
    .catalog-header {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      border-bottom: 1px solid var(--line);
      padding-bottom: 18px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 4vw, 3.4rem);
      line-height: 1;
      font-weight: 760;
    }
    .lede {
      margin: 0;
      max-width: 760px;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.55;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(92px, 1fr));
      gap: 8px;
      min-width: 310px;
    }
    .stat {
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 10px;
      border-radius: 8px;
    }
    .stat strong {
      display: block;
      font-size: 1.35rem;
      line-height: 1.1;
    }
    .stat span {
      color: var(--muted);
      font-size: .78rem;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(210px, 1fr) repeat(3, minmax(138px, 180px));
      gap: 10px;
      margin: 20px 0;
    }
    input, select, button {
      min-height: 42px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: var(--accent);
      border-color: #c24a40;
      font-weight: 700;
    }
    button.secondary {
      background: var(--panel-2);
      border-color: var(--line);
    }
    .result-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      margin-bottom: 14px;
      font-size: .92rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
      gap: 14px;
    }
    .armor-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
      min-width: 0;
    }
    .thumb {
      aspect-ratio: 16 / 10;
      background: linear-gradient(135deg, #2a2521, #171412);
      display: grid;
      place-items: center;
      overflow: hidden;
      color: var(--muted);
      font-size: .86rem;
      text-align: center;
      padding: 18px;
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .card-body {
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .card-title {
      margin: 0;
      font-size: 1rem;
      line-height: 1.25;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      background: var(--chip);
      color: var(--muted);
      padding: 2px 8px;
      font-size: .76rem;
      white-space: nowrap;
    }
    .chip.tier { color: var(--ink); border: 1px solid var(--line); }
    .chip.ready { color: var(--good); }
    .chip.needs { color: var(--warn); }
    .nexus-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border-radius: 8px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      text-decoration: none;
      font-weight: 700;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 820px;
    }
    th, td {
      padding: 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      font-size: .9rem;
    }
    th {
      color: var(--muted);
      background: var(--panel-2);
      font-size: .78rem;
      text-transform: uppercase;
    }
    .hidden { display: none !important; }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 28px;
      color: var(--muted);
      text-align: center;
    }
    @media (max-width: 780px) {
      .catalog-header, .toolbar {
        grid-template-columns: 1fr;
      }
      .stats {
        min-width: 0;
        grid-template-columns: repeat(3, 1fr);
      }
    }
  </style>
</head>
<body>
  <main class="catalog-shell">
    <header class="catalog-header">
      <div>
        <h1>Armor Catalog</h1>
        <p class="lede">Browse user-facing armor and clothing mods across JOJ, TOT, HOH, MOM, DOD, and VOV. The catalog is generated from the editable CSV source and keeps Nexus links and screenshot URLs as data.</p>
      </div>
      <section class="stats" aria-label="Catalog summary">
        <div class="stat"><strong>${entries.length}</strong><span>catalog entries</span></div>
        <div class="stat"><strong>${validation.readyPublicRows}</strong><span>ready entries</span></div>
        <div class="stat"><strong>${validation.unknownWeights}</strong><span>need tiers</span></div>
      </section>
    </header>

    <section class="toolbar" aria-label="Catalog filters">
      <input id="search" type="search" placeholder="Search armor, outfit, robe, creator...">
      <select id="modlist"><option value="">All modlists</option>${MODLISTS.map((m) => `<option value="${escapeHtml(m.label)}">${escapeHtml(m.label)}</option>`).join("")}</select>
      <select id="tier"><option value="">All tiers</option>${[...WEIGHT_TIERS].map((tier) => `<option value="${escapeHtml(tier)}">${escapeHtml(tier)}</option>`).join("")}</select>
      <button id="toggleView" type="button" class="secondary">Table view</button>
    </section>

    <div class="result-line">
      <span id="resultCount"></span>
      <span>Generated ${escapeHtml(validation.generatedAt.slice(0, 10))}</span>
    </div>

    <section id="cards" class="grid" aria-label="Armor cards"></section>
    <section id="tableView" class="table-wrap hidden" aria-label="Armor table"></section>
    <section id="empty" class="empty hidden">No catalog entries match the current filters.</section>
  </main>

  <script>
    const CATALOG = ${JSON.stringify(entries)};
    const state = { view: "cards" };
    const els = {
      search: document.getElementById("search"),
      modlist: document.getElementById("modlist"),
      tier: document.getElementById("tier"),
      cards: document.getElementById("cards"),
      table: document.getElementById("tableView"),
      empty: document.getElementById("empty"),
      resultCount: document.getElementById("resultCount"),
      toggleView: document.getElementById("toggleView")
    };

    for (const input of [els.search, els.modlist, els.tier]) input.addEventListener("input", render);
    els.toggleView.addEventListener("click", () => {
      state.view = state.view === "cards" ? "table" : "cards";
      els.toggleView.textContent = state.view === "cards" ? "Table view" : "Card view";
      render();
    });

    function filteredEntries() {
      const query = els.search.value.trim().toLowerCase();
      const modlist = els.modlist.value;
      const tier = els.tier.value;
      return CATALOG.filter((entry) => {
        const text = [entry.name, entry.canonicalName, entry.notes, entry.modlists.join(" ")].join(" ").toLowerCase();
        return (!query || text.includes(query))
          && (!modlist || entry.modlists.includes(modlist))
          && (!tier || entry.tier === tier);
      }).sort((a, b) => a.name.localeCompare(b.name));
    }

    function render() {
      const entries = filteredEntries();
      els.resultCount.textContent = entries.length + " shown";
      els.empty.classList.toggle("hidden", entries.length !== 0);
      els.cards.classList.toggle("hidden", state.view !== "cards" || entries.length === 0);
      els.table.classList.toggle("hidden", state.view !== "table" || entries.length === 0);
      if (state.view === "cards") renderCards(entries);
      else renderTable(entries);
    }

    function renderCards(entries) {
      els.cards.innerHTML = entries.map((entry) => \`
        <article class="armor-card">
          <div class="thumb">\${entry.imageUrl ? \`<img src="\${escapeAttr(entry.imageUrl)}" alt="\${escapeAttr(entry.name)} screenshot" loading="lazy" referrerpolicy="no-referrer">\` : "Screenshot pending"}</div>
          <div class="card-body">
            <h2 class="card-title">\${escapeHtml(entry.name)}</h2>
            <div class="meta">
              <span class="chip tier">\${escapeHtml(entry.tier)}</span>
              \${entry.modlists.map((modlist) => \`<span class="chip">\${escapeHtml(modlist)}</span>\`).join("")}
              <span class="chip \${entry.status === "Ready" ? "ready" : "needs"}">\${escapeHtml(entry.status)}</span>
            </div>
            \${entry.nexusUrl ? \`<a class="nexus-link" href="\${escapeAttr(entry.nexusUrl)}" target="_blank" rel="noopener noreferrer">Nexus Mods</a>\` : ""}
          </div>
        </article>\`).join("");
    }

    function renderTable(entries) {
      els.table.innerHTML = \`
        <table>
          <thead><tr><th>Mod</th><th>Tier</th><th>Modlists</th><th>Status</th><th>Nexus</th></tr></thead>
          <tbody>
            \${entries.map((entry) => \`
              <tr>
                <td>\${escapeHtml(entry.name)}</td>
                <td>\${escapeHtml(entry.tier)}</td>
                <td>\${entry.modlists.map(escapeHtml).join(", ")}</td>
                <td>\${escapeHtml(entry.status)}</td>
                <td>\${entry.nexusUrl ? \`<a href="\${escapeAttr(entry.nexusUrl)}" target="_blank" rel="noopener noreferrer">Open</a>\` : ""}</td>
              </tr>\`).join("")}
          </tbody>
        </table>\`;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function escapeAttr(value) { return escapeHtml(value); }
    render();
  </script>
</body>
</html>
`;
  await fs.writeFile(filePath, html, "utf8");
}

function parseCsv(csv) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...records] = rows;
  if (!headers) return [];
  return records
    .filter((record) => record.some((value) => value.trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
}

async function writeCsv(filePath, rows) {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function csvEscape(value) {
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Bordello Armor Catalog Builder/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printValidation(validation) {
  const warnings = validation.issues.filter((issue) => issue.level === "warning").length;
  const errors = validation.issues.filter((issue) => issue.level === "error").length;
  console.log(`Validation: ${errors} errors, ${warnings} warnings.`);
  console.log(`Public rows: ${validation.publicRows}; ready: ${validation.readyPublicRows}; missing images: ${validation.missingImages}; unknown weights: ${validation.unknownWeights}.`);
  for (const issue of validation.issues.filter((item) => item.level === "error").slice(0, 20)) {
    console.error(`Row ${issue.rowNumber}: ${issue.message}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPT_DIR);
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
const galleryCandidatesPath = getArgValue("--import-gallery-candidates");
const shouldBuild = args.has("--build") || shouldRefresh || args.has("--enrich-nexus") || args.has("--enrich-mod-search") || args.has("--enrich-mo2") || Boolean(galleryCandidatesPath);
const shouldEnrichNexus = args.has("--enrich-nexus");
const shouldEnrichModSearch = args.has("--enrich-mod-search");
const shouldEnrichMo2 = args.has("--enrich-mo2");

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

if (shouldEnrichModSearch) {
  rows = await enrichRowsWithModSearch(rows);
  await writeCsv(CSV_PATH, rows);
}

if (shouldEnrichMo2) {
  rows = await enrichRowsWithMo2(rows);
  await writeCsv(CSV_PATH, rows);
}

if (galleryCandidatesPath) {
  rows = await importGalleryCandidates(rows, galleryCandidatesPath);
  await writeCsv(CSV_PATH, rows);
}

if (shouldBuild) {
  const validation = validateRows(rows);
  await writeJson(JSON_PATH, rows, validation);
  await writeHtml(HTML_PATH, rows, validation);
  printValidation(validation);
  console.log(`Built ${relative(JSON_PATH)} and ${relative(HTML_PATH)}.`);
}

if (!shouldRefresh && !shouldBuild && !shouldEnrichNexus && !shouldEnrichMo2 && !galleryCandidatesPath) {
  console.log("Usage: npm run refresh | npm run build | npm run enrich:mod-search | npm run enrich:mo2 | npm run import:gallery | npm run enrich:nexus");
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

async function enrichRowsWithModSearch(sourceRows) {
  let enrichedCount = 0;
  let imageCount = 0;
  let tierCount = 0;
  const enriched = [];
  for (const row of sourceRows) {
    if (row.entry_type !== "Catalog Item" || !row.nexus_mod_id || !row.nexus_game_domain || row.status === "Deprecated") {
      enriched.push(row);
      continue;
    }
    try {
      const match = await fetchModSearchMatch(row);
      if (!match) {
        enriched.push(row);
        continue;
      }
      const inferredTier = inferWeightTier(match);
      const next = { ...row };
      const metadataNote = buildModSearchNote(match, inferredTier);
      next.notes = mergeNote(stripModSearchNote(row.notes), metadataNote);
      if (!next.image_url && match.thumbnailUrl) {
        next.image_url = match.thumbnailUrl;
        next.image_source_url = row.nexus_url;
        next.image_rank = "mod-search-thumbnail";
        imageCount += 1;
      }
      const canApplyTier =
        inferredTier.tier !== "Unknown"
        && inferredTier.confidence === "explicit"
        && (next.armor_weight_tier === "Unknown" || row.notes.includes("tier inferred:"));
      if (canApplyTier) {
        next.armor_weight_tier = inferredTier.tier;
        tierCount += 1;
      }
      next.status = recomputeStatus(next);
      next.last_verified = todayIso();
      enriched.push(normalizeRow(next));
      enrichedCount += 1;
      await delay(150);
    } catch (error) {
      console.warn(`Mod Search enrichment failed for ${row.display_name}: ${error.message}`);
      enriched.push(row);
    }
  }
  console.log(`Mod Search enriched ${enrichedCount} rows; filled ${imageCount} images and ${tierCount} explicit weight tiers.`);
  return enriched;
}

async function enrichRowsWithMo2(sourceRows) {
  const scan = await scanMo2Instance();
  let matchedRows = 0;
  let appliedRows = 0;
  const enriched = sourceRows.map((row) => {
    if (row.entry_type !== "Catalog Item" || row.status === "Deprecated") return row;
    const result = findMo2ScanResult(row, scan);
    if (!result || result.tier === "Unknown") return row;
    matchedRows += 1;
    const next = { ...row };
    const canApplyTier = next.armor_weight_tier === "Unknown" || next.notes.includes("tier inferred:") || next.notes.includes("MO2 scan:");
    next.notes = mergeNote(stripMo2ScanNote(next.notes), buildMo2ScanNote(result));
    if (canApplyTier) {
      next.armor_weight_tier = result.tier;
      appliedRows += 1;
    }
    next.status = recomputeStatus(next);
    next.last_verified = todayIso();
    return normalizeRow(next);
  });
  console.log(`MO2 scan matched ${matchedRows} catalog rows and applied ${appliedRows} weight tiers.`);
  return enriched;
}

async function importGalleryCandidates(sourceRows, candidatesPath) {
  const resolved = path.isAbsolute(candidatesPath) ? candidatesPath : path.join(ROOT, candidatesPath);
  const text = await fs.readFile(resolved, "utf8");
  const candidates = parseCsv(text);
  const byCatalogId = new Map();
  const byModId = new Map();
  for (const candidate of candidates) {
    const normalized = {
      catalog_id: candidate.catalog_id || "",
      nexus_mod_id: candidate.nexus_mod_id || "",
      candidate_rank: Number(candidate.candidate_rank || candidate.rank || 0),
      image_url: candidate.image_url || candidate.url || "",
      source_url: candidate.source_url || ""
    };
    if (!normalized.image_url) continue;
    if (normalized.catalog_id) pushCandidate(byCatalogId, normalized.catalog_id, normalized);
    if (normalized.nexus_mod_id) pushCandidate(byModId, normalized.nexus_mod_id, normalized);
  }
  let imported = 0;
  const enriched = sourceRows.map((row) => {
    if (row.entry_type !== "Catalog Item" || row.status === "Deprecated") return row;
    const rowCandidates = byCatalogId.get(row.catalog_id) || byModId.get(row.nexus_mod_id) || [];
    if (!rowCandidates.length) return row;
    const chosen = chooseGalleryCandidate(rowCandidates);
    const next = { ...row };
    const canReplace = !row.image_url || row.image_rank === "mod-search-thumbnail" || row.image_rank === "primary-metadata";
    next.notes = mergeNote(stripGalleryNote(row.notes), buildGalleryNote(rowCandidates, chosen));
    if (canReplace && chosen?.image_url) {
      next.image_url = chosen.image_url;
      next.image_source_url = chosen.source_url || row.nexus_url;
      next.image_rank = `gallery-${chosen.candidate_rank || rowCandidates.indexOf(chosen) + 1}`;
      next.status = recomputeStatus(next);
      next.last_verified = todayIso();
      imported += 1;
    }
    return normalizeRow(next);
  });
  console.log(`Imported gallery candidates for ${byCatalogId.size || byModId.size} rows; updated ${imported} catalog images.`);
  return enriched;
}

function pushCandidate(map, key, candidate) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(candidate);
}

function chooseGalleryCandidate(candidates) {
  const sorted = [...candidates].sort((a, b) => (a.candidate_rank || 999) - (b.candidate_rank || 999));
  return sorted.find((candidate) => candidate.candidate_rank === 2) || sorted[0];
}

function buildGalleryNote(candidates, chosen) {
  const urls = candidates
    .sort((a, b) => (a.candidate_rank || 999) - (b.candidate_rank || 999))
    .slice(0, 8)
    .map((candidate) => `${candidate.candidate_rank}:${candidate.image_url}`)
    .join(" ");
  return `Gallery candidates imported; chosen rank ${chosen?.candidate_rank || "n/a"}; candidates ${urls}`;
}

function stripGalleryNote(note) {
  return String(note || "")
    .split(" | ")
    .filter((part) => !part.startsWith("Gallery candidates imported;"))
    .join(" | ");
}

async function scanMo2Instance() {
  const explicitModsPath = getArgValue("--mods-path") || process.env.MO2_MODS_PATH;
  const explicitProfilePath = getArgValue("--profile-path") || process.env.MO2_PROFILE_PATH;
  const instancePath = getArgValue("--mo2-instance") || process.env.MO2_INSTANCE_PATH;
  const profileName = getArgValue("--profile") || process.env.MO2_PROFILE || "Default";
  const modsPath = explicitModsPath || (instancePath ? path.join(instancePath, "mods") : "");
  const profilePath = explicitProfilePath || (instancePath ? path.join(instancePath, "profiles", profileName) : "");
  if (!modsPath || !profilePath) {
    throw new Error("MO2 scan requires --mo2-instance, or both --mods-path and --profile-path.");
  }
  await assertDirectory(modsPath, "MO2 mods path");
  await assertDirectory(profilePath, "MO2 profile path");

  const enabledMods = await readEnabledModNames(path.join(profilePath, "modlist.txt"));
  const activePlugins = await readActivePluginNames(path.join(profilePath, "plugins.txt"));
  const byModId = new Map();
  const byName = new Map();
  let scannedMods = 0;
  let scannedPlugins = 0;

  for (const modName of enabledMods) {
    const modPath = path.join(modsPath, modName);
    if (!(await pathExists(modPath))) continue;
    const plugins = await findPluginFiles(modPath, activePlugins);
    if (!plugins.length) continue;
    const meta = await readMo2Meta(path.join(modPath, "meta.ini"));
    const aggregate = {
      modName,
      modId: meta.modid || "",
      plugins: [],
      counts: { Light: 0, Heavy: 0, Clothing: 0 },
      tier: "Unknown"
    };
    for (const pluginPath of plugins) {
      try {
        const pluginScan = await scanPluginArmorKeywords(pluginPath);
        aggregate.plugins.push(path.basename(pluginPath));
        aggregate.counts.Light += pluginScan.counts.Light;
        aggregate.counts.Heavy += pluginScan.counts.Heavy;
        aggregate.counts.Clothing += pluginScan.counts.Clothing;
        scannedPlugins += 1;
      } catch (error) {
        console.warn(`Skipping ${pluginPath}: ${error.message}`);
      }
    }
    aggregate.tier = tierFromCounts(aggregate.counts);
    if (aggregate.tier === "Unknown") continue;
    scannedMods += 1;
    byName.set(normalizeKey(modName), aggregate);
    if (aggregate.modId) byModId.set(String(aggregate.modId), aggregate);
  }
  console.log(`MO2 scan read ${enabledMods.length} enabled mods, ${scannedPlugins} plugins, and found armor keywords in ${scannedMods} mods.`);
  return { byModId, byName, modsPath, profilePath };
}

async function assertDirectory(directoryPath, label) {
  const stat = await fs.stat(directoryPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${directoryPath}`);
}

async function readEnabledModNames(modlistPath) {
  const text = await fs.readFile(modlistPath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1).trim())
    .filter((name) => name && !/^DLC:/.test(name));
}

async function readActivePluginNames(pluginsPath) {
  if (!(await pathExists(pluginsPath))) return null;
  const text = await fs.readFile(pluginsPath, "utf8");
  const active = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("*"))
    .map((line) => line.slice(1).toLowerCase());
  return active.length ? new Set(active) : null;
}

async function readMo2Meta(metaPath) {
  if (!(await pathExists(metaPath))) return {};
  const text = await fs.readFile(metaPath, "utf8");
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) meta[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return meta;
}

async function findPluginFiles(modPath, activePlugins) {
  const found = [];
  await walk(modPath, 2, async (filePath) => {
    if (!/\.(esp|esm|esl)$/i.test(filePath)) return;
    if (activePlugins && !activePlugins.has(path.basename(filePath).toLowerCase())) return;
    found.push(filePath);
  });
  return found;
}

async function walk(directoryPath, depth, onFile) {
  if (depth < 0) return;
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) await walk(entryPath, depth - 1, onFile);
    else if (entry.isFile()) await onFile(entryPath);
  }
}

async function scanPluginArmorKeywords(pluginPath) {
  const buffer = await fs.readFile(pluginPath);
  const context = { masters: [], skyrimMasterIndex: 0, counts: { Light: 0, Heavy: 0, Clothing: 0 } };
  scanPluginRange(buffer, 0, buffer.length, context);
  return context;
}

function scanPluginRange(buffer, start, end, context) {
  let offset = start;
  while (offset + 24 <= end) {
    const signature = ascii(buffer, offset, 4);
    if (signature === "GRUP") {
      const groupSize = buffer.readUInt32LE(offset + 4);
      if (groupSize < 24) break;
      scanPluginRange(buffer, offset + 24, Math.min(offset + groupSize, end), context);
      offset += groupSize;
      continue;
    }
    const recordSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 24;
    const dataEnd = dataStart + recordSize;
    if (dataEnd > end) break;
    if (signature === "TES4") parseTes4Masters(buffer, dataStart, dataEnd, context);
    if (signature === "ARMO") parseArmoKeywords(buffer, dataStart, dataEnd, context);
    offset = dataEnd;
  }
}

function parseTes4Masters(buffer, start, end, context) {
  for (const field of iterateSubrecords(buffer, start, end)) {
    if (field.type === "MAST") context.masters.push(readCString(buffer, field.start, field.end));
  }
  const skyrimIndex = context.masters.findIndex((master) => master.toLowerCase() === "skyrim.esm");
  context.skyrimMasterIndex = skyrimIndex >= 0 ? skyrimIndex : 0;
}

function parseArmoKeywords(buffer, start, end, context) {
  const keywords = [];
  for (const field of iterateSubrecords(buffer, start, end)) {
    if (field.type !== "KWDA") continue;
    for (let offset = field.start; offset + 4 <= field.end; offset += 4) {
      keywords.push(buffer.readUInt32LE(offset));
    }
  }
  const expected = skyrimArmorKeywordIds(context.skyrimMasterIndex);
  const hasLight = keywords.includes(expected.Light);
  const hasHeavy = keywords.includes(expected.Heavy);
  const hasClothing = keywords.includes(expected.Clothing);
  if (hasLight) context.counts.Light += 1;
  if (hasHeavy) context.counts.Heavy += 1;
  if (hasClothing) context.counts.Clothing += 1;
}

function* iterateSubrecords(buffer, start, end) {
  let offset = start;
  let overrideSize = null;
  while (offset + 6 <= end) {
    const type = ascii(buffer, offset, 4);
    const size = buffer.readUInt16LE(offset + 4);
    const dataStart = offset + 6;
    const dataSize = overrideSize ?? size;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > end) break;
    if (type === "XXXX" && size === 4) {
      overrideSize = buffer.readUInt32LE(dataStart);
      offset = dataEnd;
      continue;
    }
    yield { type, start: dataStart, end: dataEnd };
    overrideSize = null;
    offset = dataEnd;
  }
}

function skyrimArmorKeywordIds(masterIndex) {
  const prefix = masterIndex << 24;
  return {
    Light: (prefix | 0x0006BBD2) >>> 0,
    Heavy: (prefix | 0x0006BBD3) >>> 0,
    Clothing: (prefix | 0x000A8657) >>> 0
  };
}

function tierFromCounts(counts) {
  const hasLight = counts.Light > 0;
  const hasHeavy = counts.Heavy > 0;
  const hasClothing = counts.Clothing > 0;
  if ((hasLight && hasHeavy) || (hasClothing && (hasLight || hasHeavy))) return "Mixed";
  if (hasLight) return "Light";
  if (hasHeavy) return "Heavy";
  if (hasClothing) return "Clothing";
  return "Unknown";
}

function findMo2ScanResult(row, scan) {
  if (row.nexus_mod_id && scan.byModId.has(String(row.nexus_mod_id))) return scan.byModId.get(String(row.nexus_mod_id));
  const candidates = [row.canonical_mod_name, row.display_name].map(normalizeKey);
  return candidates.map((key) => scan.byName.get(key)).find(Boolean) || null;
}

function buildMo2ScanNote(result) {
  return `MO2 scan: ${result.modName}; plugins: ${result.plugins.join(", ")}; ARMO keyword counts L/H/C ${result.counts.Light}/${result.counts.Heavy}/${result.counts.Clothing}; tier: ${result.tier}`;
}

function stripMo2ScanNote(note) {
  return String(note || "")
    .split(" | ")
    .filter((part) => !part.startsWith("MO2 scan:"))
    .join(" | ");
}

async function fetchModSearchMatch(row) {
  const response = await fetch("https://nexus-mods-moderator-tools.vercel.app/api/nexusmods/mods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        op: "AND",
        name: { value: row.canonical_mod_name || row.display_name, op: "WILDCARD" },
        gameDomainName: { value: row.nexus_game_domain, op: "EQUALS" }
      },
      sort: { endorsements: { direction: "DESC" } },
      offset: 0
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const nodes = payload?.mods?.nodes || [];
  return nodes.find((node) => String(node.modId) === String(row.nexus_mod_id)) || null;
}

function inferWeightTier(match) {
  const text = `${match.name || ""} ${match.summary || ""} ${match.category || ""}`.toLowerCase();
  const hasMixedArmor =
    /\b(light|heavy)\s+(or|and|\/)\s+(light|heavy)\s+(armor|armour)\b/.test(text)
    || /\b(cloth|clothing)\b.{0,80}\blight\b.{0,80}\bheavy\s+(armor|armour)\b/.test(text)
    || /\blight\b.{0,80}\bheavy\s+(armor|armour)\s+sets?\b/.test(text);
  const hasLight = /\blight\s+(armor|armour)\b|\b(light|leather)\s+set\b/.test(text);
  const hasHeavy = /\bheavy\s+(armor|armour)\b|\b(heavy|plate)\s+set\b/.test(text);
  const hasClothing = /\b(clothing|clothes|robe|robes|dress|dresses|gown|outfit|bodysuit|corset|lingerie|bikini|jewelry|jewellery|amulet|necklace|earrings|veil)\b/.test(text);
  if (hasMixedArmor) return { tier: "Mixed", confidence: "explicit", reason: "mentions multiple armor weight variants" };
  if (hasLight && hasHeavy) return { tier: "Mixed", confidence: "explicit", reason: "mentions both light and heavy armor" };
  if (hasLight) return { tier: "Light", confidence: "explicit", reason: "mentions light armor" };
  if (hasHeavy) return { tier: "Heavy", confidence: "explicit", reason: "mentions heavy armor" };
  if (hasClothing && !/\b(armor|armour)\b/.test(text)) return { tier: "Clothing", confidence: "explicit", reason: "clothing/outfit wording without armor wording" };
  return { tier: "Unknown", confidence: "none", reason: "no explicit weight tier in Mod Search metadata" };
}

function buildModSearchNote(match, inferredTier) {
  const parts = [];
  if (match.category) parts.push(`Mod Search category: ${match.category}`);
  if (match.summary) parts.push(`summary: ${match.summary}`);
  if (inferredTier.tier !== "Unknown") parts.push(`tier inferred: ${inferredTier.tier} (${inferredTier.reason})`);
  return parts.join("; ");
}

function mergeNote(existing, addition) {
  if (!addition) return existing || "";
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing} | ${addition}`;
}

function stripModSearchNote(note) {
  return String(note || "")
    .split(" | ")
    .filter((part) => !part.startsWith("Mod Search category:"))
    .join(" | ");
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

function getArgValue(name) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : "";
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(se|sse|ae|skyrim special edition|main file)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ascii(buffer, offset, length) {
  return buffer.toString("ascii", offset, offset + length);
}

function readCString(buffer, start, end) {
  let stop = start;
  while (stop < end && buffer[stop] !== 0) stop += 1;
  return buffer.toString("utf8", start, stop);
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

// ═══════════════════════════════════════════════════════════════════════════
// BUILD — Transformation de la source éditoriale (src/data.js) en data pack
// ═══════════════════════════════════════════════════════════════════════════
// data.js reste le fichier que l'on ÉDITE (lisible, diffable, en français).
// Ce module le NORMALISE en pack relationnel (voir db/schema.sql) :
//   · génération d'ids stables (slugs) pour marques/plateformes/modèles,
//   · résolution des libellés de modèles en texte libre ('Golf 7 TDI',
//     'A4 (B8/B9)', 'Golf 5/6/7') vers de vrais ids de modèles,
//   · déduplication des codes d'accès et des DTC,
//   · parsing des années et des listes de plateformes.
//
// Le résultat est validé par validatePack() : une donnée incohérente fait
// échouer le build (donc la CI) AVANT toute publication.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/buildPack.test.js construit le pack depuis la VRAIE source et
//   vérifie : 0 erreur, 0 référence de modèle non résolue, dédup effective.
// · Cas d'erreurs gérés : libellé introuvable (listé dans le rapport de
//   résolution, build en échec), alias pointant vers un nom inexistant
//   (erreur explicite), plateforme de procédure inconnue (erreur).
// · Déterminisme : tris systématiques → même source = mêmes octets = même
//   sha256 (le pack ne contient aucun timestamp).
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCHEMA_VERSION, PLATFORM_WILDCARD,
  normalizeText, normalizeKey, slugify, parseYears,
} from "../../src/domain/entities.js";

// Qualificatifs non identitaires, retirés par étapes pour retrouver le
// modèle de base. Niveau 1 : motorisation/boîte/phase. Niveau 2 : finitions
// (retirées en dernier recours seulement — 'Golf 7 GTI' est un vrai modèle).
const STRIP_LEVEL_1 = new Set([
  "tdi", "tsi", "gte", "gtd", "tgi", "dsg", "4motion", "fl",
  "performance", "clubsport", "facelift",
]);
const STRIP_LEVEL_2 = new Set(["gti", "r", "rs", "fr", "cupra", "s"]);
const DISPLACEMENT_RE = /^[12][.,][0-9]$/; // '1.4', '2.0'

const TOUS_RE = /^tous(\s|$)/; // 'Tous modèles', 'Tous TDI'…

/** Découpe un libellé en texte hors parenthèses + contenus de parenthèses. */
function splitParens(label) {
  const parens = [];
  const outside = label
    .replace(/\(([^)]*)\)/g, (_, inner) => { parens.push(inner.trim()); return " "; })
    .replace(/\s+/g, " ")
    .trim();
  return { outside, parens };
}

/** Tokens châssis d'un nom de véhicule : parenthèses + finals type 'B8'/'C7'. */
function chassisTokensOfName(name) {
  const { outside, parens } = splitParens(name);
  const tokens = new Set();
  for (const p of parens) {
    for (const t of p.split(/[\s/,]+/)) {
      const k = normalizeKey(t);
      if (k.length >= 1 && k.length <= 4) tokens.add(k);
    }
  }
  // Tokens hors parenthèses (sauf le premier mot = nom du modèle) qui
  // ressemblent à un code châssis : 2-3 caractères mêlant lettres/chiffres,
  // ou deux lettres ('CC', 'CR').
  const words = normalizeText(outside).split(" ");
  for (const w of words.slice(1)) {
    const k = normalizeKey(w);
    const hasLetter = /[a-z]/.test(k);
    const hasDigit = /[0-9]/.test(k);
    if (k.length >= 2 && k.length <= 3 && hasLetter && (hasDigit || k.length === 2)) {
      tokens.add(k);
    }
  }
  return [...tokens];
}

/** Index de résolution construit une fois sur la liste des véhicules. */
function buildResolverIndex(models) {
  const byFullKey = new Map();     // brandId::key(nom complet)
  const byOutsideKey = new Map();  // brandId::key(nom hors parenthèses)
  const byChassis = new Map();     // brandId::token châssis → [models]
  for (const m of models) {
    const full = `${m.brandId}::${normalizeKey(m.name)}`;
    if (!byFullKey.has(full)) byFullKey.set(full, m);
    const { outside, parens } = splitParens(m.name);
    const outsideAndParens = `${m.brandId}::${normalizeKey(outside + parens.join(""))}`;
    if (!byFullKey.has(outsideAndParens)) byFullKey.set(outsideAndParens, m);
    const out = `${m.brandId}::${normalizeKey(outside)}`;
    if (!byOutsideKey.has(out)) byOutsideKey.set(out, m);
    for (const t of chassisTokensOfName(m.name)) {
      const k = `${m.brandId}::${t}`;
      if (!byChassis.has(k)) byChassis.set(k, []);
      byChassis.get(k).push(m);
    }
  }
  return { byFullKey, byOutsideKey, byChassis };
}

const firstWordKey = (s) => normalizeKey(normalizeText(s).split(" ")[0] ?? "");
const romanize = (s) => normalizeText(s).replace(/\biii\b/g, "3").replace(/\bii\b/g, "2");

/**
 * Résout un libellé éditorial vers des modèles, pour une marque donnée.
 * Retourne un tableau de modèles (vide = non résolu).
 */
function resolveLabel(brandId, rawLabel, procPlatforms, idx, models, aliases, depth = 0) {
  if (depth > 4) return [];
  const label = normalizeText(rawLabel).replace(/\s+avec\s+.*$/, "").trim();
  if (!label) return [];

  // 1. Alias explicite (clé = libellé d'origine exact, insensible casse/accents).
  const alias = aliases.get(normalizeKey(rawLabel));
  if (alias) return alias;

  const attempt = (lbl) => {
    const { outside, parens } = splitParens(lbl);
    // Exact (avec variantes : romain → arabe, parenthèses réordonnées, sans parenthèses).
    for (const candidate of [lbl, romanize(lbl), outside + parens.join(""), outside]) {
      const hit = idx.byFullKey.get(`${brandId}::${normalizeKey(candidate)}`) ??
                  idx.byOutsideKey.get(`${brandId}::${normalizeKey(candidate)}`);
      if (hit && (candidate !== outside || normalizeKey(candidate).length >= 3)) return [hit];
    }
    // Châssis dans les parenthèses, filtré par le mot de base ('Leon (5F)').
    const base = firstWordKey(romanize(outside || lbl));
    const viaChassis = new Map();
    for (const p of parens) {
      for (const t of p.split(/[\s/,]+/).map(normalizeKey).filter(Boolean)) {
        for (const m of idx.byChassis.get(`${brandId}::${t}`) ?? []) {
          if (firstWordKey(m.name) === base) viaChassis.set(m.id, m);
        }
      }
    }
    if (viaChassis.size) return [...viaChassis.values()];
    // Préfixe : 'Fabia 3' → 'Fabia 3 (NJ)', 'Q5' → toutes générations,
    // restreint par la plateforme de la procédure quand c'est possible.
    const k = normalizeKey(romanize(outside || lbl));
    if (k.length >= 2) {
      const hits = models.filter((m) =>
        m.brandId === brandId && normalizeKey(m.name).startsWith(k));
      if (hits.length) {
        if (!procPlatforms.includes(PLATFORM_WILDCARD)) {
          const onPlatform = hits.filter((m) =>
            (m._compatWith ?? []).some((c) => procPlatforms.includes(c)));
          if (onPlatform.length) return onPlatform;
        }
        return hits;
      }
    }
    return [];
  };

  let found = attempt(label);
  if (found.length) return found;

  // 2. Expansion des barres obliques : '(B8/B9)', 'Golf 5/6/7', 'GTI / R'.
  const { outside, parens } = splitParens(label);
  const parenWithSlash = parens.findIndex((p) => /[/,]/.test(p));
  if (parenWithSlash >= 0) {
    const variants = parens[parenWithSlash].split(/[/,]+/).map((t) => t.trim()).filter(Boolean);
    const out = new Map();
    for (const v of variants) {
      const rebuilt = `${outside} (${v})`;
      for (const m of resolveLabel(brandId, rebuilt, procPlatforms, idx, models, aliases, depth + 1)) {
        out.set(m.id, m);
      }
    }
    if (out.size) return [...out.values()];
  }
  if (outside.includes("/")) {
    const parts = outside.split(/\s*\/\s*/).filter(Boolean);
    const baseWords = parts[0].split(" ");
    const out = new Map();
    for (const [i, part] of parts.entries()) {
      // 'Golf 5/6/7' → '6' est complété en 'Golf 6' ; 'GTI / R' → 'Golf 7 R'.
      const full = i === 0 || part.includes(" ") || /^[a-z]/.test(part) && part.length > 3
        ? part
        : [...baseWords.slice(0, -1), part].join(" ");
      const rebuilt = parens.length ? `${full} (${parens.join(") (")})` : full;
      for (const m of resolveLabel(brandId, rebuilt, procPlatforms, idx, models, aliases, depth + 1)) {
        out.set(m.id, m);
      }
    }
    if (out.size) return [...out.values()];
  }

  // 3. Retrait progressif des qualificatifs (motorisation puis finition).
  for (const level of [STRIP_LEVEL_1, new Set([...STRIP_LEVEL_1, ...STRIP_LEVEL_2])]) {
    const kept = outside.split(" ").filter(
      (w) => !level.has(normalizeKey(w)) && !DISPLACEMENT_RE.test(w));
    if (kept.length && kept.length < outside.split(" ").length) {
      const rebuilt = parens.length
        ? `${kept.join(" ")} (${parens.join(") (")})`
        : kept.join(" ");
      const r = resolveLabel(brandId, rebuilt, procPlatforms, idx, models, aliases, depth + 1);
      if (r.length) return r;
    }
  }
  return [];
}

/**
 * Construit le data pack complet depuis le module source (src/data.js).
 * @param {Object} source  Namespace du module data.js.
 * @param {Object} options { dataVersion: number, aliases: Record<label, nom[]> }
 * @returns {{ pack: Object, resolution: { resolved: Array, unresolved: Array, mergedSecurityCodes: string[], mergedDtcs: string[] } }}
 */
export function buildPackFromSource(source, options) {
  const { dataVersion, aliases: rawAliases = {} } = options;

  // ── Marques ───────────────────────────────────────────────────────────────
  const brands = source.MARQUES_ACCUEIL.map((m) => ({
    id: slugify(m.nom),
    name: m.nom,
    short: m.court,
    color1: m.couleur,
    color2: m.couleur2,
  }));
  const brandByName = new Map(brands.map((b) => [normalizeKey(b.name), b]));

  // ── Plateformes ───────────────────────────────────────────────────────────
  // Clés de PLAT_COMPAT + toutes les cibles citées ('PQ' générique) + tous
  // les tokens utilisés par les procédures.
  const platformNames = new Set(Object.keys(source.PLAT_COMPAT));
  for (const targets of Object.values(source.PLAT_COMPAT)) {
    for (const t of targets) if (t !== PLATFORM_WILDCARD) platformNames.add(t);
  }
  const parsePlatforms = (s) =>
    String(s).split(/[/,]/).map((t) => t.trim()).filter(Boolean);
  for (const item of source.DB) {
    for (const t of parsePlatforms(item.plateforme)) {
      if (t !== PLATFORM_WILDCARD) platformNames.add(t);
    }
  }
  const platforms = [...platformNames].sort().map((name) => ({
    id: slugify(name),
    name,
    compatWith: source.PLAT_COMPAT[name] ?? [name, PLATFORM_WILDCARD],
  }));
  const compatByName = new Map(platforms.map((p) => [p.name, p.compatWith]));

  // ── Catégories ────────────────────────────────────────────────────────────
  const categories = source.CATEGORIES.filter((c) => c !== "Toutes").map((name) => ({
    id: slugify(name),
    name,
    icon: source.CATEGORIE_ICON?.[name] ?? null,
  }));
  const categoryByName = new Map(categories.map((c) => [normalizeKey(c.name), c]));

  // ── Modèles ───────────────────────────────────────────────────────────────
  const usedModelIds = new Set();
  const models = source.VEHICULES.map((v) => {
    const brand = brandByName.get(normalizeKey(v.marque));
    const shortSlug = brand ? slugify(brand.short) : slugify(v.marque);
    let id = `${shortSlug}-${slugify(v.nom)}`;
    while (usedModelIds.has(id)) id += "-2";
    usedModelIds.add(id);
    const years = parseYears(v.annees);
    return {
      id,
      brandId: brand?.id ?? slugify(v.marque),
      name: v.nom,
      platform: v.plat,
      chassisCodes: chassisTokensOfName(v.nom).map((t) => t.toUpperCase()),
      yearsLabel: v.annees,
      yearFrom: years.yearFrom,
      yearTo: years.yearTo,
      // Champ interne pour le filtre plateforme du résolveur (retiré du pack).
      _compatWith: compatByName.get(v.plat) ?? [],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const modelByBrandAndName = new Map(
    models.map((m) => [`${m.brandId}::${normalizeKey(m.name)}`, m]));

  // ── Alias : libellé exact → noms de véhicules (doivent exister) ──────────
  const aliasErrors = [];
  const aliasMap = new Map();
  for (const [label, noms] of Object.entries(rawAliases)) {
    const resolved = [];
    for (const nom of noms) {
      let hit = null;
      for (const b of brands) {
        hit = modelByBrandAndName.get(`${b.id}::${normalizeKey(nom)}`);
        if (hit) break;
      }
      if (!hit) aliasErrors.push(`alias '${label}' → '${nom}' : véhicule inexistant`);
      else resolved.push(hit);
    }
    aliasMap.set(normalizeKey(label), resolved);
  }

  // ── Calculateurs ──────────────────────────────────────────────────────────
  const ecus = [...source.CALCULATEURS]
    .map((c) => ({ address: c.code, name: c.nom, description: c.desc }))
    .sort((a, b) => a.address.localeCompare(b.address));
  const ecuAddresses = new Set(ecus.map((e) => e.address));

  // ── Codes d'accès : déduplication + fusion des calculateurs ──────────────
  const mergedSecurityCodes = [];
  const secMap = new Map();
  for (const entry of source.CODES_ACCES_INDEX) {
    const addresses = String(entry.calculateur)
      .split(/[\s,]+/).map((t) => t.trim()).filter((t) => ecuAddresses.has(t));
    const prev = secMap.get(entry.code);
    if (!prev) {
      secMap.set(entry.code, { code: entry.code, ecuAddresses: addresses, usage: entry.usage });
    } else {
      mergedSecurityCodes.push(entry.code);
      prev.ecuAddresses = [...new Set([...prev.ecuAddresses, ...addresses])];
      if (entry.usage.length > prev.usage.length) prev.usage = entry.usage;
    }
  }
  const securityCodes = [...secMap.values()]
    .map((s) => ({ ...s, ecuAddresses: [...s.ecuAddresses].sort() }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // ── DTC : déduplication par code ─────────────────────────────────────────
  const mergedDtcs = [];
  const dtcMap = new Map();
  for (const d of source.CODES_DEFAUTS) {
    if (dtcMap.has(d.code)) { mergedDtcs.push(d.code); continue; }
    dtcMap.set(d.code, { code: d.code, title: d.nom, causes: d.cause, severity: d.gravite });
  }
  const dtcs = [...dtcMap.values()].sort((a, b) => a.code.localeCompare(b.code));

  // ── Emplacements OBD ──────────────────────────────────────────────────────
  const obdLocations = source.OBD_LOCATIONS.map((o) => ({
    brandId: brandByName.get(normalizeKey(o.marque))?.id ?? slugify(o.marque),
    modelsLabel: o.modeles,
    location: o.location,
  }));

  // ── Procédures + résolution des libellés de modèles ──────────────────────
  const idx = buildResolverIndex(models);
  const resolved = [];
  const unresolved = [];
  const procedures = source.DB.map((item) => {
    const brand = brandByName.get(normalizeKey(item.marque));
    const category = categoryByName.get(normalizeKey(item.categorie));
    const procPlatforms = parsePlatforms(item.plateforme);
    let appliesToAll = false;
    let audienceNote = null;
    const modelRefs = [];
    for (const label of item.modeles) {
      if (TOUS_RE.test(normalizeText(label))) {
        appliesToAll = true;
        const qualifier = normalizeText(label)
          .replace(/^tous (modeles|les modeles)?\s*/, "").trim();
        if (qualifier && !audienceNote) audienceNote = qualifier;
        modelRefs.push({ label, modelIds: [] });
        continue;
      }
      const hits = resolveLabel(
        brand?.id, label, procPlatforms, idx, models, aliasMap);
      const modelIds = [...new Set(hits.map((m) => m.id))].sort();
      modelRefs.push({ label, modelIds });
      if (modelIds.length) {
        resolved.push({ procedure: item.id, label, models: hits.map((m) => m.name).sort() });
      } else {
        unresolved.push({ procedure: item.id, label });
      }
    }
    return {
      id: item.id,
      brandId: brand?.id ?? slugify(item.marque),
      categoryId: category?.id ?? slugify(item.categorie),
      title: item.fonction,
      difficulty: item.difficulte,
      platforms: procPlatforms,
      appliesToAll,
      audienceNote,
      models: modelRefs,
      explanation: source.EXPLICATIONS?.[item.id] ?? null,
      note: item.note ? item.note : null,
      steps: item.chemin.map((s) => ({ n: s.etape, text: s.action })),
      securityCodes: item.codesAcces ?? [],
    };
  }).sort((a, b) => a.id - b.id);

  const pack = {
    schemaVersion: SCHEMA_VERSION,
    dataVersion,
    brands,
    platforms,
    categories,
    models: models.map(({ _compatWith, ...m }) => m),
    ecus,
    securityCodes,
    dtcs,
    obdLocations,
    procedures,
  };

  return {
    pack,
    resolution: { resolved, unresolved, mergedSecurityCodes, mergedDtcs, aliasErrors },
  };
}

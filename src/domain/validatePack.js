// ═══════════════════════════════════════════════════════════════════════════
// DOMAINE — Validateur d'intégrité du data pack
// ═══════════════════════════════════════════════════════════════════════════
// Fonction PURE, sans dépendance : elle est exécutée à trois moments clés.
//   1. Au build (scripts/build-datapack.mjs) → la CI échoue si la donnée
//      éditoriale est incohérente : rien d'invalide ne peut être publié.
//   2. Au runtime (src/data/sync.js) → un pack téléchargé corrompu ou
//      incohérent est REJETÉ et l'app conserve sa base actuelle (rollback).
//   3. Dans les tests (tests/validatePack.test.js) → chaque règle est
//      vérifiée sur des packs volontairement cassés.
//
// C'est l'équivalent JS des contraintes du schéma SQL (db/schema.sql) :
// FK ↔ vérifications de références, CHECK ↔ énumérations, UNIQUE ↔ doublons.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · Cas d'erreurs couverts : référence inconnue (marque, plateforme,
//   catégorie, modèle, ECU), doublon d'id/de code, énumération invalide,
//   étapes non contiguës, référence de modèle non résolue, modèle d'une
//   autre marque rattaché à une procédure, années incohérentes.
// · `errors` = bloquant (pack refusé) ; `warnings` = qualité (publication
//   possible, à corriger). Le mode strict du build transforme les warnings
//   en échec.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCHEMA_VERSION, DIFFICULTY_VALUES, SEVERITY_VALUES, PLATFORM_WILDCARD,
} from "./entities.js";

/**
 * @typedef {Object} ValidationReport
 * @property {boolean}  ok       true si aucune erreur bloquante.
 * @property {string[]} errors   Violations d'intégrité (pack inutilisable).
 * @property {string[]} warnings Problèmes de qualité non bloquants.
 * @property {Object}   stats    Comptages par entité.
 */

const isStr = (v) => typeof v === "string" && v.length > 0;
const isInt = (v) => Number.isInteger(v);

/**
 * Valide l'intégrité référentielle et structurelle d'un data pack.
 * Ne lève jamais : retourne toujours un rapport.
 * @param {*} pack
 * @returns {ValidationReport}
 */
export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (pack === null || typeof pack !== "object" || Array.isArray(pack)) {
    return {
      ok: false,
      errors: ["pack : doit être un objet JSON"],
      warnings,
      stats: {},
    };
  }

  // ── Versions ──────────────────────────────────────────────────────────────
  if (!isInt(pack.schemaVersion)) err("schemaVersion : entier requis");
  else if (pack.schemaVersion !== SCHEMA_VERSION)
    err(`schemaVersion : ${pack.schemaVersion} non supporté (app = ${SCHEMA_VERSION})`);
  if (!isInt(pack.dataVersion) || pack.dataVersion < 1)
    err("dataVersion : entier ≥ 1 requis");

  // Toutes les collections doivent être des tableaux (même vides).
  const COLLECTIONS = [
    "brands", "platforms", "categories", "models", "ecus",
    "securityCodes", "dtcs", "obdLocations", "procedures",
  ];
  for (const k of COLLECTIONS) {
    if (!Array.isArray(pack[k])) err(`${k} : tableau requis`);
  }
  if (errors.length) {
    return { ok: false, errors, warnings, stats: {} };
  }

  // ── Marques ───────────────────────────────────────────────────────────────
  const brandIds = new Set();
  for (const b of pack.brands) {
    if (!isStr(b.id) || !isStr(b.name) || !isStr(b.short)) {
      err(`brand ${JSON.stringify(b.id ?? b.name)} : id, name, short requis`);
      continue;
    }
    if (brandIds.has(b.id)) err(`brand '${b.id}' : id en double`);
    brandIds.add(b.id);
  }

  // ── Plateformes ───────────────────────────────────────────────────────────
  const platformNames = new Set();
  const platformIds = new Set();
  for (const p of pack.platforms) {
    if (!isStr(p.id) || !isStr(p.name)) {
      err(`platform ${JSON.stringify(p.id ?? p.name)} : id et name requis`);
      continue;
    }
    if (platformIds.has(p.id)) err(`platform '${p.id}' : id en double`);
    platformIds.add(p.id);
    platformNames.add(p.name);
    if (!Array.isArray(p.compatWith) || p.compatWith.length === 0)
      err(`platform '${p.name}' : compatWith non vide requis`);
  }
  // Les cibles de compatWith doivent exister (ou être le joker).
  for (const p of pack.platforms) {
    for (const target of p.compatWith ?? []) {
      if (target !== PLATFORM_WILDCARD && !platformNames.has(target))
        err(`platform '${p.name}' : compatWith → '${target}' inconnu`);
    }
  }

  // ── Catégories ────────────────────────────────────────────────────────────
  const categoryIds = new Set();
  for (const c of pack.categories) {
    if (!isStr(c.id) || !isStr(c.name)) {
      err(`category ${JSON.stringify(c.id ?? c.name)} : id et name requis`);
      continue;
    }
    if (categoryIds.has(c.id)) err(`category '${c.id}' : id en double`);
    categoryIds.add(c.id);
  }

  // ── Modèles ───────────────────────────────────────────────────────────────
  const modelById = new Map();
  const modelBrandName = new Set();
  for (const m of pack.models) {
    if (!isStr(m.id) || !isStr(m.name) || !isStr(m.brandId)) {
      err(`model ${JSON.stringify(m.id ?? m.name)} : id, name, brandId requis`);
      continue;
    }
    if (modelById.has(m.id)) err(`model '${m.id}' : id en double`);
    modelById.set(m.id, m);
    if (!brandIds.has(m.brandId))
      err(`model '${m.name}' : marque inconnue '${m.brandId}'`);
    const bn = `${m.brandId}::${m.name}`;
    if (modelBrandName.has(bn)) err(`model '${m.name}' : doublon dans la marque '${m.brandId}'`);
    modelBrandName.add(bn);
    if (!isStr(m.platform) || !platformNames.has(m.platform))
      err(`model '${m.name}' : plateforme inconnue '${m.platform}'`);
    if (!isStr(m.yearsLabel)) err(`model '${m.name}' : yearsLabel requis`);
    if (m.yearFrom != null && m.yearTo != null && m.yearFrom > m.yearTo)
      err(`model '${m.name}' : années incohérentes (${m.yearFrom} > ${m.yearTo})`);
    if (m.yearFrom == null) warn(`model '${m.name}' : années non parsées ('${m.yearsLabel}')`);
  }

  // ── Calculateurs ──────────────────────────────────────────────────────────
  const ecuAddresses = new Set();
  for (const e of pack.ecus) {
    if (!isStr(e.address) || !isStr(e.name) || !isStr(e.description)) {
      err(`ecu ${JSON.stringify(e.address)} : address, name, description requis`);
      continue;
    }
    if (ecuAddresses.has(e.address)) err(`ecu '${e.address}' : adresse en double`);
    ecuAddresses.add(e.address);
  }

  // ── Codes d'accès ─────────────────────────────────────────────────────────
  const securityCodes = new Set();
  for (const s of pack.securityCodes) {
    if (!isStr(s.code) || !isStr(s.usage)) {
      err(`securityCode ${JSON.stringify(s.code)} : code et usage requis`);
      continue;
    }
    if (securityCodes.has(s.code)) err(`securityCode '${s.code}' : doublon`);
    securityCodes.add(s.code);
    for (const a of s.ecuAddresses ?? []) {
      if (!ecuAddresses.has(a))
        warn(`securityCode '${s.code}' : calculateur inconnu '${a}'`);
    }
  }

  // ── DTC ───────────────────────────────────────────────────────────────────
  const dtcCodes = new Set();
  for (const d of pack.dtcs) {
    if (!isStr(d.code) || !isStr(d.title) || !isStr(d.causes)) {
      err(`dtc ${JSON.stringify(d.code)} : code, title, causes requis`);
      continue;
    }
    if (dtcCodes.has(d.code)) err(`dtc '${d.code}' : code en double`);
    dtcCodes.add(d.code);
    if (!SEVERITY_VALUES.includes(d.severity))
      err(`dtc '${d.code}' : gravité invalide '${d.severity}'`);
  }

  // ── Emplacements OBD ──────────────────────────────────────────────────────
  for (const o of pack.obdLocations) {
    if (!isStr(o.brandId) || !brandIds.has(o.brandId))
      err(`obdLocation '${o.modelsLabel}' : marque inconnue '${o.brandId}'`);
    if (!isStr(o.modelsLabel) || !isStr(o.location))
      err(`obdLocation : modelsLabel et location requis`);
  }

  // ── Procédures ────────────────────────────────────────────────────────────
  const procedureIds = new Set();
  let unresolvedModelRefs = 0;
  for (const p of pack.procedures) {
    const tag = `procedure #${p?.id} '${p?.title ?? "?"}'`;
    if (!isInt(p.id)) { err(`${tag} : id entier requis`); continue; }
    if (procedureIds.has(p.id)) err(`${tag} : id en double`);
    procedureIds.add(p.id);

    if (!isStr(p.title)) err(`${tag} : title requis`);
    if (!brandIds.has(p.brandId)) err(`${tag} : marque inconnue '${p.brandId}'`);
    if (!categoryIds.has(p.categoryId)) err(`${tag} : catégorie inconnue '${p.categoryId}'`);
    if (!DIFFICULTY_VALUES.includes(p.difficulty))
      err(`${tag} : difficulté invalide '${p.difficulty}'`);

    // Plateformes : noms existants ou joker.
    if (!Array.isArray(p.platforms) || p.platforms.length === 0)
      err(`${tag} : au moins une plateforme requise`);
    for (const pl of p.platforms ?? []) {
      if (pl !== PLATFORM_WILDCARD && !platformNames.has(pl))
        err(`${tag} : plateforme inconnue '${pl}'`);
    }

    // Étapes : non vides, numérotées 1..N sans trou.
    if (!Array.isArray(p.steps) || p.steps.length === 0) {
      err(`${tag} : au moins une étape requise`);
    } else {
      p.steps.forEach((s, i) => {
        if (!isStr(s.text)) err(`${tag} : étape ${i + 1} sans texte`);
        if (s.n !== i + 1) err(`${tag} : numérotation d'étapes non contiguë (${s.n} ≠ ${i + 1})`);
      });
    }

    // Références de modèles : résolues, et de la MÊME marque que la
    // procédure — c'est la règle qui empêche structurellement qu'un codage
    // Audi soit rattaché à une Golf.
    if (!Array.isArray(p.models)) {
      err(`${tag} : models doit être un tableau`);
    } else {
      if (!p.appliesToAll && p.models.length === 0)
        err(`${tag} : aucun modèle référencé (et appliesToAll = false)`);
      for (const ref of p.models) {
        if (!isStr(ref.label)) { err(`${tag} : référence de modèle sans label`); continue; }
        const ids = ref.modelIds ?? [];
        if (ids.length === 0 && !p.appliesToAll) {
          unresolvedModelRefs++;
          warn(`${tag} : référence '${ref.label}' non résolue vers un modèle`);
        }
        for (const id of ids) {
          const m = modelById.get(id);
          if (!m) err(`${tag} : modèle inconnu '${id}' (label '${ref.label}')`);
          else if (m.brandId !== p.brandId)
            err(`${tag} : modèle '${m.name}' (${m.brandId}) rattaché à une procédure ${p.brandId}`);
        }
      }
    }

    for (const c of p.securityCodes ?? []) {
      if (!isStr(c)) err(`${tag} : code d'accès vide`);
    }
  }

  const stats = {
    brands: pack.brands.length,
    platforms: pack.platforms.length,
    categories: pack.categories.length,
    models: pack.models.length,
    ecus: pack.ecus.length,
    securityCodes: pack.securityCodes.length,
    dtcs: pack.dtcs.length,
    obdLocations: pack.obdLocations.length,
    procedures: pack.procedures.length,
    unresolvedModelRefs,
  };

  return { ok: errors.length === 0, errors, warnings, stats };
}

/** Formate un rapport pour la console / les logs CI. */
export function formatReport(report) {
  const lines = [];
  const s = report.stats ?? {};
  lines.push(
    `Pack : ${s.procedures ?? "?"} procédures · ${s.models ?? "?"} modèles · ` +
    `${s.dtcs ?? "?"} DTC · ${s.ecus ?? "?"} ECU · ${s.securityCodes ?? "?"} codes d'accès`
  );
  if (report.errors?.length) {
    lines.push(`✖ ${report.errors.length} erreur(s) :`);
    report.errors.forEach((e) => lines.push(`   · ${e}`));
  }
  if (report.warnings?.length) {
    lines.push(`⚠ ${report.warnings.length} avertissement(s) :`);
    report.warnings.forEach((w) => lines.push(`   · ${w}`));
  }
  if (report.ok && !report.warnings?.length) lines.push("✓ Intégrité OK");
  return lines.join("\n");
}

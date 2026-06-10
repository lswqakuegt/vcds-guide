// ═══════════════════════════════════════════════════════════════════════════
// DOMAINE — Entités du data pack VCDS
// ═══════════════════════════════════════════════════════════════════════════
// Couche la plus interne (Clean Architecture) : aucune dépendance vers React,
// Capacitor, le réseau ou le stockage. Uniquement des définitions de types
// (JSDoc), des énumérations et des fonctions pures de normalisation.
//
// Le pack JSON est la sérialisation du schéma relationnel db/schema.sql :
// chaque typedef ci-dessous correspond à une table.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · Fonctions pures testées dans tests/validatePack.test.js (normalizeKey,
//   parseYears, slugify : entrées vides, accents, tirets typographiques).
// · Les énumérations sont la source unique utilisée par le validateur ET par
//   le schéma SQL (CHECK) — toute divergence fait échouer la CI.
// ─────────────────────────────────────────────────────────────────────────────

/** Version du schéma de pack que cette version de l'app sait lire. */
export const SCHEMA_VERSION = 1;

export const DIFFICULTY_VALUES = ["Facile", "Moyenne", "Avancée"];
export const SEVERITY_VALUES = ["Faible", "Moyen", "Grave"];

/** Plateforme sentinelle « s'applique partout ». */
export const PLATFORM_WILDCARD = "Tous";

/**
 * @typedef {Object} Brand
 * @property {string} id       Slug stable ('volkswagen').
 * @property {string} name     'Volkswagen'.
 * @property {string} short    'VW'.
 * @property {string} [color1]
 * @property {string} [color2]
 */

/**
 * @typedef {Object} Platform
 * @property {string}   id         Slug ('mqb-evo').
 * @property {string}   name       'MQB Evo'.
 * @property {string[]} compatWith Noms de plateformes de procédures acceptées
 *                                 (inclut PLATFORM_WILDCARD).
 */

/**
 * @typedef {Object} VehicleModel
 * @property {string}      id           Slug stable ('vw-golf-7-5g').
 * @property {string}      brandId
 * @property {string}      name         'Golf 7 (5G)'.
 * @property {string}      platform     Nom de plateforme ('MQB').
 * @property {string[]}    chassisCodes ['5G'].
 * @property {string}      yearsLabel   '2012–2020' (affichage).
 * @property {number|null} yearFrom
 * @property {number|null} yearTo       null = toujours produit.
 */

/**
 * @typedef {Object} Ecu
 * @property {string} address     Adresse VCDS ('01', '5F').
 * @property {string} name
 * @property {string} description
 */

/**
 * @typedef {Object} SecurityCode
 * @property {string}   code         '20103'.
 * @property {string[]} ecuAddresses Adresses concernées (peut être vide).
 * @property {string}   usage
 */

/**
 * @typedef {Object} Category
 * @property {string} id   Slug ('eclairage').
 * @property {string} name 'Éclairage'.
 * @property {string} [icon]
 */

/**
 * @typedef {Object} ProcedureStep
 * @property {number} n    Numéro d'étape (1..N, contigu).
 * @property {string} text Instruction.
 */

/**
 * @typedef {Object} ProcedureModelRef
 * @property {string}   label    Libellé éditorial d'origine ('Golf 7 TDI').
 * @property {string[]} modelIds Modèles résolus (≥1 sauf appliesToAll).
 */

/**
 * @typedef {Object} Procedure
 * @property {number}              id            Id numérique STABLE (les
 *   favoris/notes utilisateurs stockés en local pointent dessus).
 * @property {string}              brandId
 * @property {string}              categoryId
 * @property {string}              title
 * @property {string}              difficulty    ∈ DIFFICULTY_VALUES.
 * @property {string[]}            platforms     Noms ('MQB') ou PLATFORM_WILDCARD.
 * @property {boolean}             appliesToAll  true = 'Tous modèles…'.
 * @property {string|null}         audienceNote  'diesel', 'DSG'… si appliesToAll.
 * @property {ProcedureModelRef[]} models
 * @property {string|null}         explanation
 * @property {string|null}         note
 * @property {ProcedureStep[]}     steps
 * @property {string[]}            securityCodes Libellés d'origine.
 */

/**
 * @typedef {Object} Dtc
 * @property {string} code     'P0420' / '00778'.
 * @property {string} title
 * @property {string} causes
 * @property {string} severity ∈ SEVERITY_VALUES.
 */

/**
 * @typedef {Object} ObdLocation
 * @property {string} brandId
 * @property {string} modelsLabel
 * @property {string} location
 */

/**
 * @typedef {Object} DataPack
 * @property {number}         schemaVersion
 * @property {number}         dataVersion   Entier croissant à chaque publication.
 * @property {string}         [generatedAt]
 * @property {Brand[]}        brands
 * @property {Platform[]}     platforms
 * @property {Category[]}     categories
 * @property {VehicleModel[]} models
 * @property {Ecu[]}          ecus
 * @property {SecurityCode[]} securityCodes
 * @property {Dtc[]}          dtcs
 * @property {ObdLocation[]}  obdLocations
 * @property {Procedure[]}    procedures
 */

/**
 * @typedef {Object} Manifest  Contrat publié à côté du pack (sync distante).
 * @property {number} schemaVersion
 * @property {number} dataVersion
 * @property {string} file      Nom du fichier pack ('datapack.json').
 * @property {string} sha256    Empreinte hex du fichier pack.
 * @property {number} sizeBytes
 * @property {string} [updatedAt]
 */

// ── Normalisation (pure, déterministe) ──────────────────────────────────────

/** Minuscules, sans accents, tirets typographiques unifiés, espaces réduits. */
export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Clé de comparaison : normalizeText + suppression de tout non-alphanumérique. */
export function normalizeKey(s) {
  return normalizeText(s).replace(/[^a-z0-9]/g, "");
}

/** Slug lisible et stable pour les ids ('Golf 7 (5G)' → 'golf-7-5g'). */
export function slugify(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse un libellé d'années ('2012–2020', '2019+', '1996-2003').
 * @returns {{ yearFrom: number|null, yearTo: number|null }}
 */
export function parseYears(label) {
  const t = normalizeText(label);
  let m = t.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (m) return { yearFrom: Number(m[1]), yearTo: Number(m[2]) };
  m = t.match(/^(\d{4})\s*\+$/);
  if (m) return { yearFrom: Number(m[1]), yearTo: null };
  return { yearFrom: null, yearTo: null };
}

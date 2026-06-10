// ═══════════════════════════════════════════════════════════════════════════
// DATA — Repository : accès indexé et règles de compatibilité
// ═══════════════════════════════════════════════════════════════════════════
// Unique point d'accès aux données pour le reste de l'application (pattern
// Repository de la Clean Architecture). Construit une fois par pack :
//   · index O(1) sur tous les identifiants (modèles, procédures, DTC, ECU,
//     codes d'accès, marques, plateformes),
//   · règles de compatibilité véhicule ↔ procédure.
//
// Règle de compatibilité (cœur métier — identique au comportement validé
// de l'app v3, désormais centralisé et testé) :
//   une procédure s'applique à un véhicule si
//     1. MÊME MARQUE (un codage Audi n'est jamais proposé pour une VW), ET
//     2. recouvrement de PLATEFORME : la plateforme du véhicule accepte au
//        moins une des plateformes de la procédure ('Tous' = joker).
//
// Au volume actuel (~10 000 lignes au total), ces index en mémoire sont plus
// rapides qu'un SQLite traversant le pont WebView ; au-delà de ~50 000
// lignes, remplacer ce module par un adaptateur SQLite en conservant la même
// interface (le schéma db/schema.sql est prêt).
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/repository.test.js : une Golf 7 (5G) ne reçoit JAMAIS un codage
//   Audi A3 8L (et réciproquement), isolation entre marques, jokers 'Tous',
//   véhicule inconnu → réponse explicite sans exception, recherche DTC/ECU.
// · Cas d'erreurs : id inconnu → null / liste vide + raison ; pack invalide
//   → le constructeur refuse de démarrer (l'appelant retombe sur le pack
//   embarqué).
// ─────────────────────────────────────────────────────────────────────────────

import { PLATFORM_WILDCARD, normalizeKey } from "../domain/entities.js";
import { validatePack } from "../domain/validatePack.js";

export class VcdsRepository {
  /**
   * @param {Object} pack Data pack VALIDE (voir validatePack).
   * @throws {Error} si le pack est invalide — ne jamais servir de données
   *                 incohérentes est préférable à un crash aléatoire plus tard.
   */
  constructor(pack) {
    const report = validatePack(pack);
    if (!report.ok) {
      throw new Error(`Pack invalide : ${report.errors[0]} (+${report.errors.length - 1} autres)`);
    }
    this.pack = pack;
    this.stats = report.stats;

    this.brandsById = new Map(pack.brands.map((b) => [b.id, b]));
    this.categoriesById = new Map(pack.categories.map((c) => [c.id, c]));
    this.modelsById = new Map(pack.models.map((m) => [m.id, m]));
    this.modelsByNameKey = new Map(
      pack.models.map((m) => [`${m.brandId}::${normalizeKey(m.name)}`, m]));
    this.proceduresById = new Map(pack.procedures.map((p) => [p.id, p]));
    this.dtcsByCode = new Map(pack.dtcs.map((d) => [d.code, d]));
    this.ecusByAddress = new Map(pack.ecus.map((e) => [e.address, e]));
    this.securityByCode = new Map(pack.securityCodes.map((s) => [s.code, s]));
    // plateforme véhicule → ensemble des plateformes de procédures acceptées
    this.compatByPlatformName = new Map(
      pack.platforms.map((p) => [p.name, new Set(p.compatWith)]));
    // procédures par marque (pré-filtre le parcours le plus fréquent)
    this.proceduresByBrand = new Map();
    for (const p of pack.procedures) {
      if (!this.proceduresByBrand.has(p.brandId)) this.proceduresByBrand.set(p.brandId, []);
      this.proceduresByBrand.get(p.brandId).push(p);
    }
  }

  // ── Lectures simples ───────────────────────────────────────────────────────

  getProcedure(id) { return this.proceduresById.get(id) ?? null; }
  getDtc(code) { return this.dtcsByCode.get(code) ?? null; }
  getEcu(address) { return this.ecusByAddress.get(address) ?? null; }
  getSecurityCode(code) { return this.securityByCode.get(code) ?? null; }
  getModel(id) { return this.modelsById.get(id) ?? null; }

  /** Recherche un modèle par son nom affiché ('Golf 7 (5G)'), toutes marques. */
  getModelByName(name) {
    for (const b of this.pack.brands) {
      const hit = this.modelsByNameKey.get(`${b.id}::${normalizeKey(name)}`);
      if (hit) return hit;
    }
    return null;
  }

  // ── Compatibilité véhicule ↔ procédure ────────────────────────────────────

  /**
   * @returns {{compatible: boolean, reasons: string[]}} raisons remplies
   *          uniquement en cas d'INcompatibilité (diagnostic/debug/UI).
   */
  isCompatible(procedure, model) {
    const reasons = [];
    if (!procedure || !model) {
      return { compatible: false, reasons: ["procédure ou véhicule manquant"] };
    }
    if (procedure.brandId !== model.brandId) {
      reasons.push(`marque : procédure ${procedure.brandId} ≠ véhicule ${model.brandId}`);
    }
    const accepted = this.compatByPlatformName.get(model.platform) ?? new Set();
    const platformOk = procedure.platforms.some(
      (p) => p === PLATFORM_WILDCARD || accepted.has(p));
    if (!platformOk) {
      reasons.push(
        `plateforme : ${procedure.platforms.join("/")} non compatible ${model.platform}`);
    }
    return { compatible: reasons.length === 0, reasons };
  }

  /**
   * Toutes les procédures applicables à un véhicule.
   * @param {string} modelId
   * @returns {{model: Object|null, procedures: Object[], error?: string}}
   *          Jamais d'exception : véhicule inconnu → réponse explicite.
   */
  getProceduresForVehicle(modelId) {
    const model = this.modelsById.get(modelId) ?? null;
    if (!model) {
      return { model: null, procedures: [], error: `véhicule inconnu : '${modelId}'` };
    }
    const candidates = this.proceduresByBrand.get(model.brandId) ?? [];
    return {
      model,
      procedures: candidates.filter((p) => this.isCompatible(p, model).compatible),
    };
  }

  // ── Recherche ──────────────────────────────────────────────────────────────

  /**
   * Recherche de procédures — mêmes critères que l'UI v3 (titre, catégorie,
   * marque, libellés de modèles, plateforme, explication).
   * @param {Object} f { query?, brandName?, categoryName?, modelId? }
   */
  searchProcedures(f = {}) {
    const q = normalizeKey(f.query ?? "") ? (f.query ?? "").toLowerCase() : "";
    const model = f.modelId ? this.modelsById.get(f.modelId) : null;
    if (f.modelId && !model) return [];
    return this.pack.procedures.filter((p) => {
      if (f.brandName && this.brandsById.get(p.brandId)?.name !== f.brandName) return false;
      if (f.categoryName &&
          this.categoriesById.get(p.categoryId)?.name !== f.categoryName) return false;
      if (model && !this.isCompatible(p, model).compatible) return false;
      if (!q) return true;
      const brand = this.brandsById.get(p.brandId)?.name ?? "";
      const cat = this.categoriesById.get(p.categoryId)?.name ?? "";
      const hay = [
        p.title, cat, brand,
        p.models.map((m) => m.label).join(" "),
        p.platforms.join(" "),
        p.explanation ?? "",
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  searchDtcs(query = "") {
    const q = (query ?? "").toLowerCase().trim();
    if (!q) return this.pack.dtcs;
    return this.pack.dtcs.filter((d) =>
      d.code.toLowerCase().includes(q) ||
      d.title.toLowerCase().includes(q) ||
      d.causes.toLowerCase().includes(q));
  }

  searchEcus(query = "") {
    const q = (query ?? "").toLowerCase().trim();
    if (!q) return this.pack.ecus;
    return this.pack.ecus.filter((e) =>
      e.address.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q));
  }
}

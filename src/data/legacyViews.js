// ═══════════════════════════════════════════════════════════════════════════
// DATA — Vues « legacy » : pack normalisé → formes attendues par l'UI v3
// ═══════════════════════════════════════════════════════════════════════════
// L'UI existante (App.jsx) consomme les formes historiques de data.js
// (DB, VEHICULES, CALCULATEURS…). Cet adaptateur les reconstruit depuis le
// pack relationnel : l'UI n'a pas eu à être réécrite, et pourra migrer
// progressivement vers le repository.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/repository.test.js vérifie la cohérence des vues (mêmes comptages
//   que le pack, ids stables — les favoris/notes des utilisateurs, stockés
//   par id de procédure, survivent à la migration).
// · Cas limite : marque/catégorie inconnue impossible ici (le pack est
//   validé en amont), d'où l'absence de gestion d'erreur défensive.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {Object} pack Data pack validé. */
export function buildLegacyViews(pack) {
  const brandName = new Map(pack.brands.map((b) => [b.id, b.name]));
  const categoryName = new Map(pack.categories.map((c) => [c.id, c.name]));

  return {
    DB: pack.procedures.map((p) => ({
      id: p.id,
      marque: brandName.get(p.brandId),
      modeles: p.models.map((m) => m.label),
      plateforme: p.platforms.join(" / "),
      categorie: categoryName.get(p.categoryId),
      fonction: p.title,
      difficulte: p.difficulty,
      chemin: p.steps.map((s) => ({ etape: s.n, action: s.text })),
      note: p.note ?? "",
      codesAcces: p.securityCodes,
    })),
    EXPLICATIONS: Object.fromEntries(
      pack.procedures.filter((p) => p.explanation).map((p) => [p.id, p.explanation])),
    CALCULATEURS: pack.ecus.map((e) => ({
      code: e.address, nom: e.name, desc: e.description,
    })),
    CODES_ACCES_INDEX: pack.securityCodes.map((s) => ({
      code: s.code,
      calculateur: s.ecuAddresses.length ? s.ecuAddresses.join(", ") : "Divers",
      usage: s.usage,
    })),
    CODES_DEFAUTS: pack.dtcs.map((d) => ({
      code: d.code, nom: d.title, cause: d.causes, gravite: d.severity,
    })),
    OBD_LOCATIONS: pack.obdLocations.map((o) => ({
      marque: brandName.get(o.brandId), modeles: o.modelsLabel, location: o.location,
    })),
    VEHICULES: pack.models.map((m) => ({
      nom: m.name,
      marque: brandName.get(m.brandId),
      plat: m.platform,
      annees: m.yearsLabel,
    })),
    PLAT_COMPAT: Object.fromEntries(
      pack.platforms.map((p) => [p.name, p.compatWith])),
  };
}

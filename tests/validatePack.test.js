// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Validateur d'intégrité du data pack
// ═══════════════════════════════════════════════════════════════════════════
// Chaque règle du validateur est éprouvée sur un pack volontairement cassé :
// si une de ces corruptions passait, elle finirait en production.

import { describe, it, expect } from "vitest";
import { validatePack } from "../src/domain/validatePack.js";
import { normalizeKey, slugify, parseYears } from "../src/domain/entities.js";
import { makeMinimalPack } from "./helpers.js";

const mutate = (fn) => {
  const pack = makeMinimalPack();
  fn(pack);
  return validatePack(pack);
};

describe("validatePack — cas nominal", () => {
  it("accepte le pack minimal de référence", () => {
    const report = validatePack(makeMinimalPack());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.procedures).toBe(2);
  });

  it("rejette ce qui n'est pas un objet", () => {
    expect(validatePack(null).ok).toBe(false);
    expect(validatePack([]).ok).toBe(false);
    expect(validatePack("{}").ok).toBe(false);
  });
});

describe("validatePack — versions et collections", () => {
  it("rejette un schemaVersion non supporté", () => {
    const r = mutate((p) => { p.schemaVersion = 999; });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("schemaVersion");
  });

  it("rejette un dataVersion invalide", () => {
    expect(mutate((p) => { p.dataVersion = 0; }).ok).toBe(false);
    expect(mutate((p) => { p.dataVersion = "1"; }).ok).toBe(false);
  });

  it("rejette une collection manquante", () => {
    const r = mutate((p) => { delete p.dtcs; });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("dtcs");
  });
});

describe("validatePack — intégrité référentielle", () => {
  it("rejette un modèle dont la marque n'existe pas", () => {
    const r = mutate((p) => { p.models[0].brandId = "porsche"; });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("marque inconnue");
  });

  it("rejette un modèle sur une plateforme inconnue", () => {
    expect(mutate((p) => { p.models[0].platform = "MQC"; }).ok).toBe(false);
  });

  it("rejette une cible de compatibilité de plateforme inconnue", () => {
    expect(mutate((p) => { p.platforms[0].compatWith.push("PQ99"); }).ok).toBe(false);
  });

  it("rejette les doublons d'identifiants", () => {
    expect(mutate((p) => { p.models[1].id = p.models[0].id; }).ok).toBe(false);
    expect(mutate((p) => { p.dtcs.push({ ...p.dtcs[0] }); }).ok).toBe(false);
    expect(mutate((p) => { p.securityCodes.push({ ...p.securityCodes[0] }); }).ok).toBe(false);
    expect(mutate((p) => { p.procedures[1].id = 1; }).ok).toBe(false);
  });

  it("rejette des années incohérentes", () => {
    expect(mutate((p) => { p.models[0].yearFrom = 2030; }).ok).toBe(false);
  });
});

describe("validatePack — énumérations", () => {
  it("rejette une gravité DTC hors énumération", () => {
    expect(mutate((p) => { p.dtcs[0].severity = "Critique"; }).ok).toBe(false);
  });

  it("rejette une difficulté hors énumération", () => {
    expect(mutate((p) => { p.procedures[0].difficulty = "Expert"; }).ok).toBe(false);
  });
});

describe("validatePack — procédures", () => {
  it("rejette une catégorie inconnue", () => {
    expect(mutate((p) => { p.procedures[0].categoryId = "tuning"; }).ok).toBe(false);
  });

  it("rejette une plateforme de procédure inconnue", () => {
    expect(mutate((p) => { p.procedures[0].platforms = ["MQC"]; }).ok).toBe(false);
  });

  it("rejette une procédure sans étapes ou mal numérotée", () => {
    expect(mutate((p) => { p.procedures[0].steps = []; }).ok).toBe(false);
    expect(mutate((p) => {
      p.procedures[0].steps = [{ n: 1, text: "a" }, { n: 3, text: "b" }];
    }).ok).toBe(false);
  });

  it("REJETTE un modèle d'une autre marque rattaché à une procédure " +
     "(un codage Audi ne peut pas référencer une Golf)", () => {
    const r = mutate((p) => {
      p.procedures[1].models = [{ label: "Golf 7 (5G)", modelIds: ["vw-golf-7-5g"] }];
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("rattaché à une procédure audi");
  });

  it("signale (warning) une référence de modèle non résolue", () => {
    const r = mutate((p) => {
      p.procedures[0].models = [{ label: "Golf 12", modelIds: [] }];
    });
    expect(r.ok).toBe(true); // non bloquant au runtime…
    expect(r.warnings.join()).toContain("non résolue");
    expect(r.stats.unresolvedModelRefs).toBe(1); // …mais bloquant au build
  });

  it("accepte une procédure 'Tous modèles' sans modèle résolu", () => {
    const r = mutate((p) => {
      p.procedures[0].appliesToAll = true;
      p.procedures[0].models = [{ label: "Tous modèles", modelIds: [] }];
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("signale (warning) un code d'accès pointant un calculateur inconnu", () => {
    const r = mutate((p) => { p.securityCodes[0].ecuAddresses = ["ZZ"]; });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toContain("calculateur inconnu");
  });
});

describe("entities — normalisation", () => {
  it("normalise accents, romains et tirets typographiques", () => {
    expect(normalizeKey("Léon — Tëst")).toBe("leontest");
    expect(slugify("Golf 7 (5G)")).toBe("golf-7-5g");
  });

  it("parse les libellés d'années", () => {
    expect(parseYears("2012–2020")).toEqual({ yearFrom: 2012, yearTo: 2020 });
    expect(parseYears("2019+")).toEqual({ yearFrom: 2019, yearTo: null });
    expect(parseYears("n/a")).toEqual({ yearFrom: null, yearTo: null });
  });
});

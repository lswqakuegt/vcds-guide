// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Repository : compatibilité véhicule ↔ procédure (base réelle)
// ═══════════════════════════════════════════════════════════════════════════
// LE test demandé par le cahier des charges : si l'utilisateur choisit une
// Golf 7, l'app ne doit JAMAIS lui proposer un codage d'Audi A3 8L — et
// réciproquement. Vérifié ici sur la base de données réelle complète.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildPackFromSource } from "../scripts/lib/buildPack.mjs";
import { VcdsRepository } from "../src/data/repository.js";
import { buildLegacyViews } from "../src/data/legacyViews.js";
import * as source from "../src/data.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const aliases = JSON.parse(readFileSync(join(root, "scripts/model-aliases.json"), "utf8"));

let repo, golf7, a3_8l;
beforeAll(() => {
  const { pack } = buildPackFromSource(source, { dataVersion: 1, aliases });
  repo = new VcdsRepository(pack);
  golf7 = repo.getModelByName("Golf 7 (5G)");
  a3_8l = repo.getModelByName("A3 8L");
});

describe("isolation entre marques et plateformes (Golf 7 vs A3 8L)", () => {
  it("connaît les deux véhicules du scénario", () => {
    expect(golf7).not.toBeNull();
    expect(golf7.brandId).toBe("volkswagen");
    expect(a3_8l).not.toBeNull();
    expect(a3_8l.brandId).toBe("audi");
  });

  it("une Golf 7 ne reçoit AUCUNE procédure Audi", () => {
    const { procedures, error } = repo.getProceduresForVehicle(golf7.id);
    expect(error).toBeUndefined();
    expect(procedures.length).toBeGreaterThan(0);
    expect(procedures.every((p) => p.brandId === "volkswagen")).toBe(true);
  });

  it("une A3 8L ne reçoit AUCUNE procédure VW, ni les procédures Audi MQB/MLB", () => {
    const { procedures } = repo.getProceduresForVehicle(a3_8l.id);
    expect(procedures.every((p) => p.brandId === "audi")).toBe(true);
    // La procédure n°3 (Start & Stop Audi) est MQB/MLB : hors plateforme PQ34.
    expect(procedures.map((p) => p.id)).not.toContain(3);
  });

  it("aucun recouvrement entre les procédures Golf 7 et A3 8L", () => {
    const g = new Set(repo.getProceduresForVehicle(golf7.id).procedures.map((p) => p.id));
    const a = repo.getProceduresForVehicle(a3_8l.id).procedures.map((p) => p.id);
    expect(a.filter((id) => g.has(id))).toEqual([]);
  });

  it("explique POURQUOI une procédure est incompatible (marque ET plateforme)", () => {
    const proc1 = repo.getProcedure(1); // Start & Stop VW, plateforme MQB
    expect(repo.isCompatible(proc1, golf7).compatible).toBe(true);
    const verdict = repo.isCompatible(proc1, a3_8l);
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons.join()).toContain("marque");
    expect(verdict.reasons.join()).toContain("plateforme");
  });
});

describe("règles de compatibilité — jokers et héritage de plateforme", () => {
  it("'Tous' s'applique à toute la marque, mais jamais aux autres marques", () => {
    const wildcard = repo.pack.procedures.find(
      (p) => p.brandId === "volkswagen" && p.platforms.includes("Tous"));
    expect(wildcard).toBeDefined();
    const golf4 = repo.getModelByName("Golf 4 (1J)");
    expect(repo.isCompatible(wildcard, golf4).compatible).toBe(true);
    expect(repo.isCompatible(wildcard, a3_8l).compatible).toBe(false);
  });

  it("MQB Evo hérite des procédures MQB (Golf 8 reçoit du MQB)", () => {
    const golf8 = repo.getModelByName("Golf 8 (CD)");
    const proc1 = repo.getProcedure(1); // MQB
    expect(repo.isCompatible(proc1, golf8).compatible).toBe(true);
  });
});

describe("cas d'erreurs — jamais d'exception, toujours une réponse explicite", () => {
  it("véhicule inconnu → erreur explicite et liste vide", () => {
    const r = repo.getProceduresForVehicle("vw-golf-42-zz");
    expect(r.model).toBeNull();
    expect(r.procedures).toEqual([]);
    expect(r.error).toContain("véhicule inconnu");
  });

  it("lectures par id inconnu → null (pas de throw)", () => {
    expect(repo.getProcedure(999999)).toBeNull();
    expect(repo.getDtc("P9999")).toBeNull();
    expect(repo.getEcu("ZZ")).toBeNull();
    expect(repo.getModelByName("Batmobile")).toBeNull();
  });

  it("un pack invalide est refusé à la construction (défense en profondeur)", () => {
    expect(() => new VcdsRepository({ schemaVersion: 999 })).toThrow(/invalide/i);
  });
});

describe("recherche", () => {
  it("retrouve un DTC par code, nom ou cause", () => {
    expect(repo.searchDtcs("P0420").map((d) => d.code)).toContain("P0420");
    expect(repo.searchDtcs("braquage").map((d) => d.code)).toContain("00778");
    expect(repo.searchDtcs("").length).toBe(repo.pack.dtcs.length);
  });

  it("retrouve un calculateur par nom ou adresse", () => {
    expect(repo.searchEcus("gateway").map((e) => e.address)).toContain("19");
    expect(repo.searchEcus("5F").map((e) => e.address)).toContain("5F");
  });

  it("recherche de procédures filtrée par véhicule : tout est compatible", () => {
    const results = repo.searchProcedures({ query: "start", modelId: golf7.id });
    expect(results.length).toBeGreaterThan(0);
    for (const p of results) {
      expect(repo.isCompatible(p, golf7).compatible, `#${p.id}`).toBe(true);
    }
  });

  it("recherche avec véhicule inconnu → liste vide (pas de throw)", () => {
    expect(repo.searchProcedures({ query: "start", modelId: "nope" })).toEqual([]);
  });
});

describe("vues legacy — contrat avec l'UI v3", () => {
  it("reconstruit les formes historiques avec les mêmes ids stables", () => {
    const legacy = buildLegacyViews(repo.pack);
    expect(legacy.DB.length).toBe(source.DB.length);
    expect(legacy.DB[0].id).toBe(source.DB[0].id);
    expect(legacy.DB[0].chemin[0].etape).toBe(1);
    expect(legacy.EXPLICATIONS[1]).toBeTruthy();
    expect(legacy.VEHICULES.length).toBe(repo.pack.models.length);
    expect(Object.keys(legacy.PLAT_COMPAT)).toContain("MQB Evo");
    const codes = legacy.CODES_ACCES_INDEX.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

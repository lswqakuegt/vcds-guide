// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Pipeline de build sur la VRAIE source éditoriale (src/data.js)
// ═══════════════════════════════════════════════════════════════════════════
// Ces tests rejouent exactement ce que fait `npm run gen:data` : si l'un
// d'eux casse, la CI bloque la publication d'une base incohérente.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildPackFromSource } from "../scripts/lib/buildPack.mjs";
import { validatePack } from "../src/domain/validatePack.js";
import * as source from "../src/data.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const aliases = JSON.parse(readFileSync(join(root, "scripts/model-aliases.json"), "utf8"));

let built;
beforeAll(() => {
  built = buildPackFromSource(source, { dataVersion: 1, aliases });
});

describe("buildPack — intégrité de la base réelle", () => {
  it("produit un pack valide (0 erreur d'intégrité)", () => {
    const report = validatePack(built.pack);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("résout 100 % des références de modèles (0 libellé orphelin)", () => {
    expect(built.resolution.unresolved).toEqual([]);
  });

  it("n'a aucun alias mort dans scripts/model-aliases.json", () => {
    expect(built.resolution.aliasErrors).toEqual([]);
  });

  it("toutes les références non 'Tous modèles' pointent vers ≥ 1 modèle réel", () => {
    for (const proc of built.pack.procedures) {
      for (const ref of proc.models) {
        if (!proc.appliesToAll) {
          expect(ref.modelIds.length, `#${proc.id} '${ref.label}'`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("conserve les ids de procédures de la source (favoris/notes utilisateurs)", () => {
    const sourceIds = [...source.DB.map((p) => p.id)].sort((a, b) => a - b);
    const packIds = built.pack.procedures.map((p) => p.id);
    expect(packIds).toEqual(sourceIds);
  });
});

describe("buildPack — déduplication", () => {
  it("fusionne les doublons de codes d'accès (dont le 19249 historique)", () => {
    expect(built.resolution.mergedSecurityCodes).toContain("19249");
    const codes = built.pack.securityCodes.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("le code fusionné conserve l'union de ses calculateurs", () => {
    const c20103 = built.pack.securityCodes.find((s) => s.code === "20103");
    expect(c20103.ecuAddresses).toContain("09");
    expect(c20103.ecuAddresses).toContain("17");
  });

  it("dédoublonne les DTC par code", () => {
    const codes = built.pack.dtcs.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("buildPack — reproductibilité et hygiène", () => {
  it("est déterministe : deux builds de la même source sont identiques à l'octet", () => {
    const again = buildPackFromSource(source, { dataVersion: 1, aliases });
    expect(JSON.stringify(again.pack)).toBe(JSON.stringify(built.pack));
  });

  it("App.jsx n'importe plus src/data.js (les données sont hors du bundle UI)", () => {
    const app = readFileSync(join(root, "src/App.jsx"), "utf8");
    expect(app).not.toMatch(/from\s+["']\.\/data\.js["']/);
  });

  it("les catégories des données existent dans le vocabulaire de l'UI", async () => {
    const ui = await import("../src/presentation/uiConstants.js");
    for (const cat of built.pack.categories) {
      expect(ui.CATEGORIES, `catégorie '${cat.name}'`).toContain(cat.name);
    }
  });
});

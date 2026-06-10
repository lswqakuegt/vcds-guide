// ═══════════════════════════════════════════════════════════════════════════
// CLI — Génération du data pack : src/data.js → public/data/
// ═══════════════════════════════════════════════════════════════════════════
// Usage :
//   node scripts/build-datapack.mjs            génère pack + manifest
//   node scripts/build-datapack.mjs --check    valide sans écrire (CI rapide)
//   node scripts/build-datapack.mjs --verbose  affiche la table de résolution
//
// Branché dans `npm run build` et `npm run dev` : AUCUNE donnée incohérente
// ne peut atteindre la production — le build échoue (exit 1) si :
//   · le validateur d'intégrité remonte une erreur,
//   · une référence de modèle reste non résolue (→ ajouter le véhicule dans
//     VEHICULES, corriger le libellé, ou déclarer un alias dans
//     scripts/model-aliases.json),
//   · un alias pointe vers un véhicule inexistant.
//
// Publication d'une mise à jour de données SANS republier l'application :
//   1. éditer src/data.js, incrémenter scripts/data-version.json,
//   2. push sur main → GitHub Pages sert le nouveau manifest.json,
//   3. les applications installées le détectent au prochain démarrage
//      (voir src/data/sync.js) et téléchargent le pack.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · `npm run validate:data` = mode --check, exécuté dans les tests CI.
// · Le sha256 écrit dans le manifest est recalculé par l'app à la réception :
//   toute corruption de transfert est détectée avant l'installation du pack.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildPackFromSource } from "./lib/buildPack.mjs";
import { validatePack, formatReport } from "../src/domain/validatePack.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const checkOnly = process.argv.includes("--check");
const verbose = process.argv.includes("--verbose");

const source = await import(new URL("../src/data.js", import.meta.url));
const aliases = JSON.parse(readFileSync(join(here, "model-aliases.json"), "utf8"));
const { dataVersion } = JSON.parse(readFileSync(join(here, "data-version.json"), "utf8"));

const { pack, resolution } = buildPackFromSource(source, { dataVersion, aliases });

// ── Rapport de résolution des libellés ──────────────────────────────────────
if (verbose) {
  for (const r of resolution.resolved) {
    console.log(`  #${r.procedure} '${r.label}' → ${r.models.join(", ")}`);
  }
}
if (resolution.mergedSecurityCodes.length) {
  console.log(`Doublons codes d'accès fusionnés : ${[...new Set(resolution.mergedSecurityCodes)].join(", ")}`);
}
if (resolution.mergedDtcs.length) {
  console.log(`Doublons DTC fusionnés : ${[...new Set(resolution.mergedDtcs)].join(", ")}`);
}

let failed = false;
if (resolution.aliasErrors.length) {
  failed = true;
  console.error(`✖ Alias invalides (scripts/model-aliases.json) :`);
  resolution.aliasErrors.forEach((e) => console.error(`   · ${e}`));
}
if (resolution.unresolved.length) {
  failed = true;
  const labels = [...new Set(resolution.unresolved.map((u) => u.label))].sort();
  console.error(`✖ ${resolution.unresolved.length} référence(s) de modèle non résolue(s) (${labels.length} libellés distincts) :`);
  labels.forEach((l) => console.error(`   · '${l}'`));
  console.error("→ Corriger le libellé dans src/data.js, ajouter le véhicule dans VEHICULES,");
  console.error("  ou déclarer un alias dans scripts/model-aliases.json.");
}

// ── Validation d'intégrité ───────────────────────────────────────────────────
const report = validatePack(pack);
console.log(formatReport(report));
if (!report.ok) failed = true;

if (failed) process.exit(1);

if (!checkOnly) {
  const outDir = join(root, "public", "data");
  mkdirSync(outDir, { recursive: true });
  const packJson = JSON.stringify(pack);
  const sha256 = createHash("sha256").update(packJson).digest("hex");
  const manifest = {
    schemaVersion: pack.schemaVersion,
    dataVersion: pack.dataVersion,
    file: "datapack.json",
    sha256,
    sizeBytes: Buffer.byteLength(packJson),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "datapack.json"), packJson);
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✓ public/data/datapack.json (${(manifest.sizeBytes / 1024).toFixed(0)} ko, v${pack.dataVersion}, sha256 ${sha256.slice(0, 12)}…)`);
} else {
  console.log("✓ Mode --check : validation seule, rien n'a été écrit.");
}

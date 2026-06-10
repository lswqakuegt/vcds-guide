// ═══════════════════════════════════════════════════════════════════════════
// DATA — Initialisation offline-first de la couche données
// ═══════════════════════════════════════════════════════════════════════════
// Ordre de chargement (stratégie offline-first) :
//   1. Pack STOCKÉ localement (issu d'une synchronisation précédente).
//   2. Pack EMBARQUÉ dans le bundle (./data/datapack.json, généré au build)
//      — toujours disponible, même hors ligne au premier lancement.
//   → on garde le plus RÉCENT des deux : une mise à jour de l'app peut
//     embarquer des données plus fraîches que la dernière synchro, et
//     inversement.
//   3. En arrière-plan (sans bloquer l'affichage) : vérification du manifest
//      distant ; si un pack plus récent est validé et installé, le callback
//      onUpdate permet à l'UI de basculer à chaud.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · Si le pack stocké ET le pack embarqué sont illisibles (déploiement
//   corrompu), initVcdsData lève : le DataProvider affiche une erreur avec
//   bouton « Réessayer » plutôt qu'un écran blanc.
// · La construction du repository re-valide le pack (défense en profondeur).
// · Scénarios couverts par tests/sync.test.js + tests/repository.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { SyncService } from "./sync.js";
import { VcdsRepository } from "./repository.js";
import { buildLegacyViews } from "./legacyViews.js";
import { defaultStorage } from "./storage.js";
import { BUNDLED_DATA_BASE, getRemoteDataBase } from "./config.js";

/** Construit l'objet consommé par l'UI à partir d'un pack validé. */
export function buildBundle(pack, meta) {
  const repository = new VcdsRepository(pack);
  return {
    repository,
    legacy: buildLegacyViews(pack),
    meta: { dataVersion: pack.dataVersion, source: meta?.source ?? "bundled" },
  };
}

/**
 * @param {Object}   [opts]
 * @param {Object}   [opts.storage]   Adaptateur de stockage (tests).
 * @param {Function} [opts.fetchImpl] fetch injectable (tests).
 * @param {Function} [opts.onUpdate]  Appelé avec le résultat de la synchro
 *                                    distante ({status, pack?…}).
 * @returns {Promise<{repository, legacy, meta}>}
 */
export async function initVcdsData(opts = {}) {
  const storage = opts.storage ?? defaultStorage();
  const fetchImpl = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const sync = new SyncService({
    storage, fetchImpl, remoteBase: getRemoteDataBase(),
  });

  // 1. Pack local (synchronisé précédemment), si valide.
  const local = await sync.loadLocal();

  // 2. Pack embarqué : consulté si pas de local, ou pour vérifier que l'app
  //    n'embarque pas plus récent que le local (cas mise à jour de l'app).
  let bundled = null;
  try {
    const mRes = await fetchImpl(`${BUNDLED_DATA_BASE}manifest.json`);
    const manifest = mRes.ok ? await mRes.json() : null;
    const needBundled = !local ||
      (Number.isInteger(manifest?.dataVersion) &&
       manifest.dataVersion > (local.meta?.dataVersion ?? local.pack.dataVersion));
    if (needBundled) {
      const pRes = await fetchImpl(`${BUNDLED_DATA_BASE}${manifest?.file ?? "datapack.json"}`);
      if (pRes.ok) {
        const installed = await sync.install(await pRes.text(), { source: "bundled" });
        if (installed.ok) bundled = installed.pack;
      }
    }
  } catch {
    // pack embarqué inaccessible : on continue avec le local s'il existe
  }

  const pack = bundled ?? local?.pack;
  if (!pack) {
    throw new Error(
      "Aucune base de données disponible (pack embarqué illisible et aucun pack local).");
  }
  const bundle = buildBundle(pack, bundled ? { source: "bundled" } : local?.meta);

  // 3. Synchronisation distante en arrière-plan — ne bloque jamais l'UI.
  Promise.resolve()
    .then(() => sync.checkForUpdate(pack.dataVersion))
    .then((result) => {
      if (opts.onUpdate) {
        opts.onUpdate(result.status === "updated"
          ? { ...result, bundle: buildBundle(result.pack, { source: "remote" }) }
          : result);
      }
    })
    .catch(() => { /* jamais bloquant */ });

  return bundle;
}

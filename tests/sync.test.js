// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Synchronisation offline-first (réseau et stockage simulés)
// ═══════════════════════════════════════════════════════════════════════════
// Aucun vrai réseau : fetch et stockage sont injectés. Chaque scénario
// vérifie l'état FINAL du stockage : un échec, quel qu'il soit, ne doit
// jamais corrompre la base locale (atomicité / rollback).

import { describe, it, expect } from "vitest";
import { SyncService, sha256Hex } from "../src/data/sync.js";
import { initVcdsData } from "../src/data/index.js";
import { MemoryStorage } from "../src/data/storage.js";
import { STORAGE_KEY_PACK } from "../src/data/config.js";
import { SCHEMA_VERSION } from "../src/domain/entities.js";
import { makeMinimalPack, makeFakeFetch } from "./helpers.js";

const BASE = "https://example.test/data/";

async function setupWithLocalV1() {
  const storage = new MemoryStorage();
  const sync = new SyncService({ storage, fetchImpl: makeFakeFetch({}), remoteBase: BASE });
  const v1 = JSON.stringify(makeMinimalPack());
  await sync.install(v1, { source: "bundled" });
  return { storage, v1 };
}

function makeV2() {
  const pack = makeMinimalPack();
  pack.dataVersion = 2;
  pack.dtcs.push({ code: "P0299", title: "Sous-pression turbo", causes: "Fuite.", severity: "Moyen" });
  return JSON.stringify(pack);
}

describe("SyncService.install — validation avant écriture", () => {
  it("installe un pack valide et le relit", async () => {
    const storage = new MemoryStorage();
    const sync = new SyncService({ storage, fetchImpl: makeFakeFetch({}), remoteBase: BASE });
    const r = await sync.install(JSON.stringify(makeMinimalPack()), { source: "bundled" });
    expect(r.ok).toBe(true);
    const local = await sync.loadLocal();
    expect(local.pack.dataVersion).toBe(1);
    expect(local.meta.source).toBe("bundled");
  });

  it("refuse un JSON illisible sans toucher au stockage", async () => {
    const { storage } = await setupWithLocalV1();
    const sync = new SyncService({ storage, fetchImpl: makeFakeFetch({}), remoteBase: BASE });
    const r = await sync.install("{pas du json", { source: "remote" });
    expect(r.ok).toBe(false);
    expect((await sync.loadLocal()).pack.dataVersion).toBe(1);
  });

  it("refuse un pack qui viole l'intégrité référentielle", async () => {
    const storage = new MemoryStorage();
    const sync = new SyncService({ storage, fetchImpl: makeFakeFetch({}), remoteBase: BASE });
    const bad = makeMinimalPack();
    bad.procedures[0].models[0].modelIds = ["modele-fantome"];
    const r = await sync.install(JSON.stringify(bad), { source: "remote" });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("inconnu");
    expect(await storage.get(STORAGE_KEY_PACK)).toBeNull();
  });
});

describe("SyncService.checkForUpdate — cycle de mise à jour", () => {
  it("installe une version plus récente après contrôle sha256", async () => {
    const { storage } = await setupWithLocalV1();
    const v2 = makeV2();
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 2,
        file: "datapack.json", sha256: await sha256Hex(v2),
      } },
      [`${BASE}datapack.json`]: { text: v2 },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    const r = await sync.checkForUpdate(1);
    expect(r.status).toBe("updated");
    expect(r.dataVersion).toBe(2);
    expect((await sync.loadLocal()).pack.dataVersion).toBe(2);
  });

  it("même version → up-to-date, sans télécharger le pack", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 1, file: "datapack.json", sha256: "x".repeat(64),
      } },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    expect((await sync.checkForUpdate(1)).status).toBe("up-to-date");
    expect(fetchImpl.calls).toEqual([`${BASE}manifest.json`]);
  });

  it("sha256 falsifié → pack rejeté, base locale intacte", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 2,
        file: "datapack.json", sha256: "0".repeat(64),
      } },
      [`${BASE}datapack.json`]: { text: makeV2() },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    const r = await sync.checkForUpdate(1);
    expect(r.status).toBe("error");
    expect(r.detail).toContain("sha256");
    expect((await sync.loadLocal()).pack.dataVersion).toBe(1);
  });

  it("pack distant corrompu (JSON invalide) → erreur, base locale intacte", async () => {
    const { storage } = await setupWithLocalV1();
    const garbage = "{corrompu";
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 2,
        file: "datapack.json", sha256: await sha256Hex(garbage),
      } },
      [`${BASE}datapack.json`]: { text: garbage },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    expect((await sync.checkForUpdate(1)).status).toBe("error");
    expect((await sync.loadLocal()).pack.dataVersion).toBe(1);
  });

  it("schéma distant plus récent que l'app → app-update-required, rien téléchargé", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: {
        schemaVersion: SCHEMA_VERSION + 1, dataVersion: 9, file: "datapack.json", sha256: "x".repeat(64),
      } },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    expect((await sync.checkForUpdate(1)).status).toBe("app-update-required");
    expect(fetchImpl.calls.length).toBe(1);
    expect((await sync.loadLocal()).pack.dataVersion).toBe(1);
  });

  it("réseau coupé → offline, jamais d'exception", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({ [`${BASE}manifest.json`]: "throw" });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    expect((await sync.checkForUpdate(1)).status).toBe("offline");
  });

  it("manifest malformé → error", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({
      [`${BASE}manifest.json`]: { json: { hello: "world" } },
    });
    const sync = new SyncService({ storage, fetchImpl, remoteBase: BASE });
    expect((await sync.checkForUpdate(1)).status).toBe("error");
  });
});

describe("initVcdsData — démarrage offline-first complet", () => {
  it("premier lancement : installe le pack embarqué puis signale la synchro", async () => {
    const storage = new MemoryStorage();
    const v1 = JSON.stringify(makeMinimalPack());
    const fetchImpl = makeFakeFetch({
      "./data/manifest.json": { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 1,
        file: "datapack.json", sha256: await sha256Hex(v1),
      } },
      "./data/datapack.json": { text: v1 },
    });
    const updateResult = new Promise((resolve) => {
      initVcdsData({ storage, fetchImpl, onUpdate: resolve }).then((bundle) => {
        expect(bundle.meta.dataVersion).toBe(1);
        expect(bundle.legacy.DB.length).toBe(2);
        expect(bundle.repository.getModelByName("Golf 7 (5G)")).not.toBeNull();
      });
    });
    // La synchro d'arrière-plan voit la même version → up-to-date.
    expect((await updateResult).status).toBe("up-to-date");
  });

  it("lancements suivants hors ligne : démarre sur le pack stocké", async () => {
    const { storage } = await setupWithLocalV1();
    const fetchImpl = makeFakeFetch({
      "./data/manifest.json": "throw",
      "./data/datapack.json": "throw",
    });
    const bundle = await initVcdsData({ storage, fetchImpl });
    expect(bundle.meta.dataVersion).toBe(1);
  });

  it("aucune donnée nulle part → erreur explicite (écran Réessayer, pas d'écran blanc)", async () => {
    const storage = new MemoryStorage();
    const fetchImpl = makeFakeFetch({});
    await expect(initVcdsData({ storage, fetchImpl })).rejects.toThrow(/Aucune base/);
  });

  it("l'app embarque des données plus récentes que le pack stocké → on prend l'embarqué", async () => {
    const { storage } = await setupWithLocalV1(); // local v1
    const v2 = makeV2(); // bundle de l'app mis à jour : v2
    const fetchImpl = makeFakeFetch({
      "./data/manifest.json": { json: {
        schemaVersion: SCHEMA_VERSION, dataVersion: 2,
        file: "datapack.json", sha256: await sha256Hex(v2),
      } },
      "./data/datapack.json": { text: v2 },
    });
    const bundle = await initVcdsData({ storage, fetchImpl });
    expect(bundle.meta.dataVersion).toBe(2);
  });
});

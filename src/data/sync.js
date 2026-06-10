// ═══════════════════════════════════════════════════════════════════════════
// DATA — Service de synchronisation offline-first
// ═══════════════════════════════════════════════════════════════════════════
// Permet de publier des mises à jour de données SANS republier l'application
// sur le Play Store : l'app interroge un manifest distant (GitHub Pages) et,
// si une version plus récente existe, télécharge le pack, le VÉRIFIE puis
// l'installe localement.
//
// Garanties (transposition mobile des règles ACID utiles ici) :
//   · Intégrité de transfert : sha256 du fichier comparé au manifest.
//   · Intégrité référentielle : validatePack() rejette tout pack incohérent.
//   · Atomicité : le pack courant n'est remplacé QU'APRÈS toutes les
//     vérifications — en cas d'échec à n'importe quelle étape, l'app
//     conserve sa base actuelle (rollback implicite).
//   · Compatibilité : un manifest annonçant un schemaVersion plus récent que
//     celui que l'app sait lire renvoie 'app-update-required' (les données
//     n'avancent jamais plus vite que le code qui les interprète).
//
// Toutes les dépendances (fetch, stockage, horloge réseau) sont injectées :
// le service se teste sans réseau ni navigateur.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/sync.test.js couvre : installation initiale, mise à jour OK,
//   sha256 falsifié, JSON corrompu, pack invalide, schéma futur, réseau
//   coupé, version identique (aucun téléchargement inutile).
// ─────────────────────────────────────────────────────────────────────────────

import { SCHEMA_VERSION } from "../domain/entities.js";
import { validatePack } from "../domain/validatePack.js";
import { STORAGE_KEY_PACK, STORAGE_KEY_META } from "./config.js";

/** sha256 hexadécimal d'une chaîne (WebCrypto — dispo navigateur et Node). */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class SyncService {
  /**
   * @param {Object} deps
   * @param {{get,set,remove}} deps.storage   Adaptateur de stockage.
   * @param {Function}         [deps.fetchImpl] fetch injectable (tests).
   * @param {string}           deps.remoteBase  URL de base des données distantes.
   */
  constructor({ storage, fetchImpl, remoteBase }) {
    this.storage = storage;
    this.fetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this.remoteBase = remoteBase;
  }

  /** Pack stocké localement, ou null s'il est absent/illisible/incompatible. */
  async loadLocal() {
    try {
      const [packJson, metaJson] = await Promise.all([
        this.storage.get(STORAGE_KEY_PACK),
        this.storage.get(STORAGE_KEY_META),
      ]);
      if (!packJson) return null;
      const pack = JSON.parse(packJson);
      if (pack?.schemaVersion !== SCHEMA_VERSION) return null;
      const meta = metaJson ? JSON.parse(metaJson) : {};
      return { pack, meta };
    } catch {
      return null; // stockage corrompu → on repartira du pack embarqué
    }
  }

  /**
   * Valide puis installe un pack (chaîne JSON brute) dans le stockage.
   * @returns {{ok: true, pack}|{ok: false, errors: string[]}}
   */
  async install(packJson, { source }) {
    let pack;
    try {
      pack = JSON.parse(packJson);
    } catch {
      return { ok: false, errors: ["JSON illisible"] };
    }
    const report = validatePack(pack);
    if (!report.ok) return { ok: false, errors: report.errors };
    await this.storage.set(STORAGE_KEY_PACK, packJson);
    await this.storage.set(STORAGE_KEY_META, JSON.stringify({
      dataVersion: pack.dataVersion,
      source,
    }));
    return { ok: true, pack };
  }

  /**
   * Vérifie le manifest distant et installe un éventuel nouveau pack.
   * Ne lève jamais — retourne toujours un statut exploitable par l'UI.
   * @param {number} currentDataVersion
   * @returns {Promise<{status: 'up-to-date'|'updated'|'app-update-required'|'offline'|'error', pack?: Object, dataVersion?: number, detail?: string}>}
   */
  async checkForUpdate(currentDataVersion) {
    let manifest;
    try {
      const res = await this.fetch(`${this.remoteBase}manifest.json`, { cache: "no-store" });
      if (!res.ok) return { status: "error", detail: `manifest HTTP ${res.status}` };
      manifest = await res.json();
    } catch {
      return { status: "offline" };
    }

    if (!Number.isInteger(manifest?.dataVersion) || typeof manifest?.file !== "string") {
      return { status: "error", detail: "manifest invalide" };
    }
    if (manifest.schemaVersion > SCHEMA_VERSION) {
      return { status: "app-update-required", dataVersion: manifest.dataVersion };
    }
    if (manifest.dataVersion <= currentDataVersion) {
      return { status: "up-to-date", dataVersion: currentDataVersion };
    }

    let packJson;
    try {
      const res = await this.fetch(`${this.remoteBase}${manifest.file}`, { cache: "no-store" });
      if (!res.ok) return { status: "error", detail: `pack HTTP ${res.status}` };
      packJson = await res.text();
    } catch {
      return { status: "offline" };
    }

    // Intégrité de transfert AVANT toute installation.
    if (typeof manifest.sha256 === "string" && manifest.sha256.length === 64) {
      const actual = await sha256Hex(packJson);
      if (actual !== manifest.sha256) {
        return { status: "error", detail: "sha256 invalide — pack rejeté" };
      }
    }

    const installed = await this.install(packJson, { source: "remote" });
    if (!installed.ok) {
      return { status: "error", detail: `pack invalide : ${installed.errors[0] ?? "?"}` };
    }
    return { status: "updated", pack: installed.pack, dataVersion: installed.pack.dataVersion };
  }
}

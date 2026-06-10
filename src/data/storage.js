// ═══════════════════════════════════════════════════════════════════════════
// DATA — Abstraction de stockage clé/valeur (offline-first)
// ═══════════════════════════════════════════════════════════════════════════
// Interface async minimale { get, set, remove } pour découpler la couche
// données du support physique :
//   · web / WebView Capacitor → localStorage (le pack actuel pèse ~400 ko,
//     loin de la limite ~5 Mo),
//   · tests → MemoryStorage (aucun effet de bord),
//   · évolution (pack > 2 Mo) → adaptateur @capacitor/filesystem, sans
//     toucher au reste du code (même interface).
//
// ── Vérification ────────────────────────────────────────────────────────────
// · LocalStorageAdapter ne lève JAMAIS : quota dépassé ou stockage interdit
//   (navigation privée) → l'écriture échoue silencieusement et l'app
//   retombe sur le pack embarqué au prochain démarrage. Comportement testé
//   via MemoryStorage + adaptateur défaillant dans tests/sync.test.js.
// ─────────────────────────────────────────────────────────────────────────────

/** Stockage en mémoire — tests et environnements sans localStorage. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async set(key, value) { this.map.set(key, value); }
  async remove(key) { this.map.delete(key); }
}

/** Adaptateur localStorage, tolérant aux pannes (quota, mode privé). */
export class LocalStorageAdapter {
  async get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  async set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota / privé */ }
  }
  async remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

export function defaultStorage() {
  return typeof localStorage !== "undefined"
    ? new LocalStorageAdapter()
    : new MemoryStorage();
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA — Configuration de la couche données
// ═══════════════════════════════════════════════════════════════════════════
// ── Vérification ────────────────────────────────────────────────────────────
// · Pas de logique ici : uniquement des constantes, surchargées par injection
//   de dépendances dans les tests (tests/sync.test.js ne touche jamais au
//   vrai réseau ni au vrai localStorage).
// ─────────────────────────────────────────────────────────────────────────────

/** Clés de stockage local. Suffixées par version de schéma : un ancien pack
 *  incompatible est simplement ignoré après une mise à jour majeure. */
export const STORAGE_KEY_PACK = "vcds.datapack.s1";
export const STORAGE_KEY_META = "vcds.datapack.meta.s1";

/** Chemin des données embarquées dans le bundle (générées au build). */
export const BUNDLED_DATA_BASE = "./data/";

/**
 * Base distante pour la synchronisation. Sur le web, l'app est servie par
 * GitHub Pages : la même origine suffit. Dans l'APK Capacitor, l'origine est
 * locale (https://localhost) : on pointe explicitement vers Pages.
 */
export const REMOTE_DATA_BASE_NATIVE =
  "https://lswqakuegt.github.io/vcds-guide/data/";

export function getRemoteDataBase() {
  const isNative =
    typeof window !== "undefined" &&
    window.Capacitor?.isNativePlatform?.() === true;
  return isNative ? REMOTE_DATA_BASE_NATIVE : BUNDLED_DATA_BASE;
}

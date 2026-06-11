// ═══════════════════════════════════════════════════════════════════════════
// PRÉSENTATION — Détection d'appareil et installation PWA
// ═══════════════════════════════════════════════════════════════════════════
// Le même site sert tous les appareils ; le bon geste d'installation diffère :
//   · iPhone/iPad Safari : Partager → « Sur l'écran d'accueil » (aucune API,
//     il faut guider l'utilisateur),
//   · autres navigateurs iOS : impossible — rediriger vers Safari,
//   · Android / Chrome / Edge : événement `beforeinstallprompt` → vrai
//     bouton « Installer »,
//   · navigateurs sans PWA (Firefox desktop…) : favoris + rappel hors ligne,
//   · déjà installé (mode standalone) : ne rien proposer.
//
// La DÉTECTION est une fonction pure (testable sans navigateur) ; la capture
// de `beforeinstallprompt` est un effet de module minimal, gardé par
// `typeof window` pour rester inerte dans Node/Vitest.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/installContext.test.js : matrice d'user-agents (iPhone Safari,
//   Chrome iOS, iPad avec UA Mac, Android, desktop, mode installé) et choix
//   du message pour chaque contexte ± prompt disponible.
// · Cas d'erreurs : promptInstall sans prompt capturé → 'unavailable' ;
//   userChoice rejeté → 'dismissed' ; environnement sans window → module
//   inerte (aucun listener).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contexte d'installation, à partir de données injectables (pur).
 * @param {Object} env
 * @param {string}  env.ua             navigator.userAgent
 * @param {number}  [env.maxTouchPoints] navigator.maxTouchPoints
 * @param {boolean} [env.standaloneMedia] matchMedia('(display-mode: standalone)').matches
 * @param {boolean} [env.iosStandalone]   navigator.standalone (Safari iOS)
 * @returns {'installed'|'ios-safari'|'ios-browser'|'android'|'desktop'}
 */
export function detectInstallContext(env) {
  const ua = env?.ua ?? "";
  if (env?.standaloneMedia || env?.iosStandalone) return "installed";

  const isIDevice = /iphone|ipod|ipad/i.test(ua);
  // iPadOS 13+ se présente comme un Mac, mais avec un écran tactile.
  const isIPadDesktopUA = /macintosh/i.test(ua) && (env?.maxTouchPoints ?? 0) > 1;
  if (isIDevice || isIPadDesktopUA) {
    // Sur iOS, seule Safari peut ajouter une PWA à l'écran d'accueil.
    const isOtherBrowser = /crios|fxios|edgios|opios|opt\/|brave|duckduckgo/i.test(ua);
    return isOtherBrowser ? "ios-browser" : "ios-safari";
  }
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * Message d'installation adapté au contexte (pur).
 * @param {string}  context   Résultat de detectInstallContext.
 * @param {boolean} canPrompt Un beforeinstallprompt est-il capturé ?
 * @returns {{kind: string, icon: string, title: string, body: string, action: 'prompt'|null}}
 */
export function installMessage(context, canPrompt) {
  switch (context) {
    case "installed":
      return {
        kind: "installed", icon: "✅", action: null,
        title: "Application installée",
        body: "VCDS est installé sur cet appareil et fonctionne entièrement hors ligne — parfait au garage, même sans réseau.",
      };
    case "ios-safari":
      return {
        kind: "ios", icon: "📱", action: null,
        title: "Installer sur iPhone / iPad",
        body: "Touchez Partager (carré avec flèche ↑) en bas de Safari, puis « Sur l'écran d'accueil ». L'app s'ouvrira en plein écran et fonctionnera hors ligne, comme une vraie application — sans App Store.",
      };
    case "ios-browser":
      return {
        kind: "ios-redirect", icon: "🧭", action: null,
        title: "Ouvrez ce site dans Safari",
        body: "Sur iPhone/iPad, seul Safari permet d'installer l'app sur l'écran d'accueil. Ouvrez cette adresse dans Safari, puis Partager → « Sur l'écran d'accueil ».",
      };
    case "android":
      return canPrompt
        ? {
          kind: "prompt", icon: "🤖", action: "prompt",
          title: "Installer l'application",
          body: "Ajoutez VCDS à votre écran d'accueil : lancement direct, plein écran, et toute la base fonctionne hors ligne au garage.",
        }
        : {
          kind: "android-manual", icon: "🤖", action: null,
          title: "Installer sur Android",
          body: "Dans le menu ⋮ de votre navigateur, choisissez « Ajouter à l'écran d'accueil » (ou « Installer l'application »). VCDS fonctionnera ensuite hors ligne.",
        };
    default:
      return canPrompt
        ? {
          kind: "prompt", icon: "💻", action: "prompt",
          title: "Installer l'application",
          body: "Installez VCDS comme une application de bureau : fenêtre dédiée et fonctionnement hors ligne.",
        }
        : {
          kind: "desktop-manual", icon: "💻", action: null,
          title: "Utilisable directement — installable aussi",
          body: "Sur Chrome ou Edge, cliquez l'icône d'installation à droite de la barre d'adresse. Sinon, ajoutez simplement cette page à vos favoris : elle fonctionne aussi hors ligne.",
        };
  }
}

// ── Capture de l'événement beforeinstallprompt (effet de module minimal) ────

let deferredPrompt = null;
let appJustInstalled = false;
const listeners = new Set();
const notifyAll = () => listeners.forEach((cb) => { try { cb(); } catch { /* UI */ } });

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // on affichera notre propre bouton
    deferredPrompt = e;
    notifyAll();
  });
  window.addEventListener("appinstalled", () => {
    appJustInstalled = true;
    deferredPrompt = null;
    notifyAll();
  });
}

/** État courant : un vrai prompt natif est-il disponible / déjà installé ? */
export function getInstallState() {
  return { canPrompt: deferredPrompt !== null, justInstalled: appJustInstalled };
}

/** S'abonner aux changements d'état (retourne la fonction de désabonnement). */
export function subscribeInstallState(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Déclenche le prompt natif d'installation.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>} jamais d'exception.
 */
export async function promptInstall() {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null; // un BeforeInstallPromptEvent ne se rejoue pas
  notifyAll();
  try {
    prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "dismissed";
  }
}

/** Contexte détecté depuis le navigateur réel (enrobage non testé, trivial). */
export function detectFromBrowser() {
  if (typeof window === "undefined") return "desktop";
  return detectInstallContext({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standaloneMedia: window.matchMedia?.("(display-mode: standalone)")?.matches,
    iosStandalone: navigator.standalone === true,
  });
}

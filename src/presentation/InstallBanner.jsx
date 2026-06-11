// ═══════════════════════════════════════════════════════════════════════════
// PRÉSENTATION — Bannière d'installation adaptée à l'appareil
// ═══════════════════════════════════════════════════════════════════════════
// Affiche LE bon geste d'installation selon l'appareil (voir
// installContext.js). Deux variantes :
//   · accueil (par défaut) : carte refermable (✕), mémorisée — on ne harcèle
//     pas ; masquée si l'app est déjà installée ;
//   · réglages (variant="settings") : toujours visible, sans ✕ — l'endroit
//     où retrouver l'installation après avoir fermé la bannière.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · La logique (détection, choix du message, prompt) vit dans
//   installContext.js, testée par tests/installContext.test.js ; ce composant
//   n'est que de l'affichage d'état.
// · Cas couverts : refus du prompt natif (la bannière reste, simple log),
//   localStorage indisponible (la fermeture ne persiste pas mais ne casse
//   rien), installation détectée en cours de session (bascule du message).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import {
  detectFromBrowser, installMessage,
  getInstallState, subscribeInstallState, promptInstall,
} from "./installContext.js";

const DISMISS_KEY = "vcds.install.dismissed";
const readDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
};

export default function InstallBanner({ variant = "home" }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [install, setInstall] = useState(getInstallState);

  // beforeinstallprompt / appinstalled peuvent arriver après le rendu.
  useEffect(() => subscribeInstallState(() => setInstall(getInstallState())), []);

  const context = install.justInstalled ? "installed" : detectFromBrowser();
  const msg = installMessage(context, install.canPrompt);
  const inSettings = variant === "settings";

  // Accueil : rien si déjà installé ou si l'utilisateur a fermé la bannière.
  if (!inSettings && (context === "installed" || dismissed)) return null;

  const close = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* mode privé */ }
  };

  return (
    <div className={`ib ${inSettings ? "ib-flat" : ""}`}>
      <span className="ib-icon">{msg.icon}</span>
      <div className="ib-body">
        <div className="ib-title">{msg.title}</div>
        <div className="ib-text">{msg.body}</div>
        {msg.action === "prompt" && (
          <button className="bt ib-btn" onClick={() => promptInstall()}>
            Installer l'application
          </button>
        )}
      </div>
      {!inSettings && (
        <span className="ib-close" onClick={close} role="button" aria-label="Fermer">✕</span>
      )}
    </div>
  );
}

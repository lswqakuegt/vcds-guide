// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Détection d'appareil et message d'installation adaptatif
// ═══════════════════════════════════════════════════════════════════════════
// Matrice d'user-agents réels : chaque type d'appareil doit recevoir LE bon
// geste d'installation pour la version web (iPhone Safari ≠ Chrome iOS ≠
// Android ≠ desktop ≠ déjà installé).

import { describe, it, expect } from "vitest";
import {
  detectInstallContext, installMessage, promptInstall, getInstallState,
} from "../src/presentation/installContext.js";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.1 Mobile/15E148 Safari/605.1.15",
  ipadDesktopUA: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
};

describe("detectInstallContext — matrice d'appareils", () => {
  it("iPhone Safari → tutoriel iOS", () => {
    expect(detectInstallContext({ ua: UA.iphoneSafari })).toBe("ios-safari");
  });

  it("Chrome et Firefox sur iPhone → rediriger vers Safari", () => {
    expect(detectInstallContext({ ua: UA.iphoneChrome })).toBe("ios-browser");
    expect(detectInstallContext({ ua: UA.iphoneFirefox })).toBe("ios-browser");
  });

  it("iPad récent (UA de Mac + écran tactile) → reconnu comme iOS", () => {
    expect(detectInstallContext({ ua: UA.ipadDesktopUA, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("vrai Mac (pas tactile) → desktop, pas iOS", () => {
    expect(detectInstallContext({ ua: UA.macSafari, maxTouchPoints: 0 })).toBe("desktop");
  });

  it("Android → android", () => {
    expect(detectInstallContext({ ua: UA.androidChrome })).toBe("android");
    expect(detectInstallContext({ ua: UA.androidFirefox })).toBe("android");
  });

  it("desktop Windows → desktop", () => {
    expect(detectInstallContext({ ua: UA.windowsChrome })).toBe("desktop");
    expect(detectInstallContext({ ua: UA.windowsFirefox })).toBe("desktop");
  });

  it("mode standalone (PWA déjà installée) → installed, quel que soit l'UA", () => {
    expect(detectInstallContext({ ua: UA.androidChrome, standaloneMedia: true })).toBe("installed");
    expect(detectInstallContext({ ua: UA.iphoneSafari, iosStandalone: true })).toBe("installed");
  });

  it("entrée vide/inconnue → desktop (jamais d'exception)", () => {
    expect(detectInstallContext({})).toBe("desktop");
    expect(detectInstallContext(undefined)).toBe("desktop");
  });
});

describe("installMessage — le bon geste pour chaque contexte", () => {
  it("iOS Safari : explique Partager → Sur l'écran d'accueil (pas de bouton)", () => {
    const m = installMessage("ios-safari", false);
    expect(m.body).toContain("Partager");
    expect(m.body).toContain("écran d'accueil");
    expect(m.action).toBeNull();
  });

  it("autre navigateur iOS : renvoie vers Safari", () => {
    expect(installMessage("ios-browser", false).body).toContain("Safari");
  });

  it("Android/desktop avec prompt natif disponible : vrai bouton Installer", () => {
    expect(installMessage("android", true).action).toBe("prompt");
    expect(installMessage("desktop", true).action).toBe("prompt");
  });

  it("Android sans prompt : passe par le menu du navigateur", () => {
    const m = installMessage("android", false);
    expect(m.action).toBeNull();
    expect(m.body).toContain("écran d'accueil");
  });

  it("desktop sans prompt : barre d'adresse ou favoris + rappel hors ligne", () => {
    const m = installMessage("desktop", false);
    expect(m.action).toBeNull();
    expect(m.body.toLowerCase()).toContain("hors ligne");
  });

  it("déjà installé : confirmation, aucune action", () => {
    const m = installMessage("installed", false);
    expect(m.kind).toBe("installed");
    expect(m.action).toBeNull();
  });
});

describe("promptInstall — cas d'erreurs", () => {
  it("sans prompt capturé (Node / navigateur non éligible) → 'unavailable'", async () => {
    expect(getInstallState().canPrompt).toBe(false);
    expect(await promptInstall()).toBe("unavailable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PRÉSENTATION — DataProvider : le « ViewModel » racine des données
// ═══════════════════════════════════════════════════════════════════════════
// Équivalent React du couple ViewModel + LiveData de l'architecture MVVM
// Android : il orchestre l'initialisation asynchrone de la couche données
// (offline-first), expose un état observable (loading / error / ready) et
// bascule à chaud quand une synchronisation distante installe un pack plus
// récent. L'UI ne connaît ni le stockage, ni le réseau, ni la validation.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · États couverts : chargement (splash), échec (message + bouton
//   Réessayer — jamais d'écran blanc), prêt, mise à jour à chaud.
// · La logique sous-jacente est testée dans tests/sync.test.js et
//   tests/repository.test.js ; ce composant ne contient QUE de l'affichage
//   d'état (pas de logique métier à tester unitairement).
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState } from "react";
import { initVcdsData } from "../data/index.js";

const DataContext = createContext(null);

/** Accès aux données pour les composants (vues legacy + repository + méta). */
export function useVcdsData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useVcdsData doit être utilisé sous <DataProvider>");
  return ctx;
}

const splashStyle = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 12,
  background: "#0a0e1a", color: "#c8d8f0",
  fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24,
};

export function DataProvider({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [syncInfo, setSyncInfo] = useState({ status: "idle" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    initVcdsData({
      onUpdate: (result) => {
        if (!active) return;
        setSyncInfo({ status: result.status, dataVersion: result.dataVersion });
        if (result.status === "updated" && result.bundle) {
          // Bascule à chaud : nouveau repository + nouvelles vues.
          setState({ status: "ready", bundle: result.bundle });
        }
      },
    })
      .then((bundle) => { if (active) setState({ status: "ready", bundle }); })
      .catch((error) => { if (active) setState({ status: "error", error }); });
    return () => { active = false; };
  }, [retry]);

  if (state.status === "loading") {
    return (
      <div style={splashStyle}>
        <div style={{ fontSize: 44 }}>🔧</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>VCDS</div>
        <div style={{ opacity: 0.7, fontSize: 14 }}>Chargement de la base de données…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={splashStyle}>
        <div style={{ fontSize: 44 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Base de données indisponible</div>
        <div style={{ opacity: 0.7, fontSize: 13, maxWidth: 420 }}>
          {String(state.error?.message ?? state.error)}
        </div>
        <button
          onClick={() => setRetry((n) => n + 1)}
          style={{
            marginTop: 8, padding: "10px 22px", borderRadius: 10,
            border: "1px solid #2a5a9f", background: "#0f1e38",
            color: "#7eb8f7", fontSize: 14, cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { repository, legacy, meta } = state.bundle;
  return (
    <DataContext.Provider value={{ ...legacy, repository, dataMeta: meta, syncInfo }}>
      {children}
    </DataContext.Provider>
  );
}

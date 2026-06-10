// ═══════════════════════════════════════════════════════════════════════════
// PRÉSENTATION — Vocabulaire et habillage de l'interface
// ═══════════════════════════════════════════════════════════════════════════
// Ces constantes sont de la PRÉSENTATION (couleurs, icônes, libellés de
// filtres), pas des données métier : elles vivent dans le code, contrairement
// au contenu (procédures, DTC…) qui vit dans le data pack.
//
// Source de vérité partagée : le pipeline de build (scripts/build-datapack.mjs)
// vérifie que les catégories utilisées par les données existent bien ici.
//
// ── Vérification ────────────────────────────────────────────────────────────
// · tests/buildPack.test.js garantit que App.jsx n'importe plus src/data.js :
//   les 5 400 lignes de données sont définitivement sorties du bundle JS.
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  "Toutes", "Start / Stop", "Éclairage", "Confort", "Tableau de bord",
  "Aide à la conduite", "Boîte DSG", "Freins", "Entretien",
  "Moteur", "Sécurité", "Multimédia", "Remorque",
];

export const MARQUES = ["Toutes", "Volkswagen", "Audi", "Seat", "Skoda"];
export const DIFFICULTES = ["Toutes", "Facile", "Moyenne", "Avancée"];

export const MARQUE_LOGO = {
  Volkswagen: "🔵",
  Audi: "🔴",
  Seat: "🟡",
  Skoda: "🟢",
};

export const MARQUES_ACCUEIL = [
  { nom: "Volkswagen", court: "VW", couleur: "#1e5799", couleur2: "#2989d8" },
  { nom: "Audi", court: "AUDI", couleur: "#8b0000", couleur2: "#c8102e" },
  { nom: "Seat", court: "SEAT", couleur: "#9a7b00", couleur2: "#e3b800" },
  { nom: "Skoda", court: "SKODA", couleur: "#0e4a1e", couleur2: "#2d8c3d" },
];

export const DIFF_COLOR = {
  Facile:  { bg: "rgba(6,78,59,0.4)",   text: "#6ee7b7", dot: "#34d399", border: "#065f46" },
  Moyenne: { bg: "rgba(120,53,15,0.4)", text: "#fcd34d", dot: "#fbbf24", border: "#78350f" },
  Avancée: { bg: "rgba(136,19,55,0.4)", text: "#fda4af", dot: "#fb7185", border: "#881337" },
};

export const CATEGORIE_ICON = {
  "Start / Stop": "⏯️",
  "Éclairage": "💡",
  "Confort": "🛋️",
  "Tableau de bord": "🎛️",
  "Aide à la conduite": "🛣️",
  "Boîte DSG": "⚙️",
  "Freins": "🛑",
  "Entretien": "🔧",
  "Moteur": "🏎️",
  "Sécurité": "🛡️",
  "Multimédia": "📺",
  "Remorque": "🚛",
};

export const GRAVITE_COLOR = {
  Faible: { bg: "rgba(6,78,59,0.4)",   text: "#6ee7b7", border: "#065f46" },
  Moyen:  { bg: "rgba(120,53,15,0.4)", text: "#fcd34d", border: "#78350f" },
  Grave:  { bg: "rgba(136,19,55,0.4)", text: "#fda4af", border: "#881337" },
};

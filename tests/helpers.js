// Outils partagés des tests : pack minimal valide + faux fetch.

import { SCHEMA_VERSION } from "../src/domain/entities.js";

/**
 * Pack minimal mais COMPLET au sens du validateur : 2 marques, 2 plateformes,
 * 2 modèles (une Golf 7 MQB et une A3 8L PQ34 — le couple du test
 * d'isolation), 2 procédures. Les tests le clonent puis le mutent.
 */
export function makeMinimalPack() {
  return {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: 1,
    brands: [
      { id: "volkswagen", name: "Volkswagen", short: "VW" },
      { id: "audi", name: "Audi", short: "AUDI" },
    ],
    platforms: [
      { id: "mqb", name: "MQB", compatWith: ["MQB", "Tous"] },
      { id: "pq34", name: "PQ34", compatWith: ["PQ34", "Tous"] },
    ],
    categories: [
      { id: "eclairage", name: "Éclairage", icon: "💡" },
    ],
    models: [
      {
        id: "vw-golf-7-5g", brandId: "volkswagen", name: "Golf 7 (5G)",
        platform: "MQB", chassisCodes: ["5G"],
        yearsLabel: "2012–2020", yearFrom: 2012, yearTo: 2020,
      },
      {
        id: "audi-a3-8l", brandId: "audi", name: "A3 8L",
        platform: "PQ34", chassisCodes: ["8L"],
        yearsLabel: "1996–2003", yearFrom: 1996, yearTo: 2003,
      },
    ],
    ecus: [
      { address: "09", name: "Centrale électrique (BCM)", description: "Body Control Module." },
    ],
    securityCodes: [
      { code: "20103", ecuAddresses: ["09"], usage: "Code universel VAG." },
    ],
    dtcs: [
      { code: "P0420", title: "Efficacité catalyseur", causes: "Catalyseur vieilli.", severity: "Moyen" },
    ],
    obdLocations: [
      { brandId: "volkswagen", modelsLabel: "Golf 7 (5G)", location: "Sous le volant." },
    ],
    procedures: [
      {
        id: 1, brandId: "volkswagen", categoryId: "eclairage",
        title: "Activer Coming Home", difficulty: "Facile",
        platforms: ["MQB"], appliesToAll: false, audienceNote: null,
        models: [{ label: "Golf 7 (5G)", modelIds: ["vw-golf-7-5g"] }],
        explanation: "Éclairage automatique.", note: null,
        steps: [{ n: 1, text: "[09] → Coding → activer." }],
        securityCodes: ["20103"],
      },
      {
        id: 2, brandId: "audi", categoryId: "eclairage",
        title: "Codage feux A3 8L", difficulty: "Moyenne",
        platforms: ["PQ34"], appliesToAll: false, audienceNote: null,
        models: [{ label: "A3 8L", modelIds: ["audi-a3-8l"] }],
        explanation: null, note: null,
        steps: [{ n: 1, text: "[09] → Coding." }],
        securityCodes: [],
      },
    ],
  };
}

/**
 * Faux fetch : table url → réponse. Une réponse peut être
 * { json }, { text }, { status }, ou une fonction (pour compter/faire échouer).
 * Lève (réseau coupé) si `routes[url] === "throw"`.
 */
export function makeFakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404 };
    if (route === "throw") throw new TypeError("network down");
    const r = typeof route === "function" ? route() : route;
    const body = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

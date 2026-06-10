# Architecture des données — VCDS Guide App

> Stratégie demandée : une base exhaustive (marques → modèles/générations →
> calculateurs → procédures/codages → DTC), relationnelle, validée, mise à
> jour **sans republier l'application**, et qui reste fluide sur mobile.

## 1. Décision fondatrice : faire évoluer l'app existante

L'app v3 (React + Vite + Capacitor) fonctionnait, mais ses 5 400 lignes de
`src/data.js` étaient compilées **dans** le bundle JavaScript :

| Problème constaté (v3) | Conséquence |
|---|---|
| Données en dur dans le bundle | Toute correction = republication Play Store |
| Relations par texte libre | **145 des 216** références de modèles ne correspondaient à aucun véhicule |
| Doublons non détectés | 9 codes d'accès en double (19249, 04434, …) |
| Aucun test | Une régression de données était invisible jusqu'en production |

Réécrire en Kotlin natif aurait jeté l'UI, le déploiement GitHub Pages et le
pipeline APK existants. La cible (schéma relationnel, repository, offline-first,
tests) est **indépendante du langage** : elle est implémentée dans la stack
actuelle, et le schéma SQL canonique ([db/schema.sql](../db/schema.sql)) reste
prêt pour une migration native Room ou un backend.

## 2. Le modèle relationnel

Référence : [db/schema.sql](../db/schema.sql) — exécutable tel quel sur SQLite,
transposable 1:1 en entités Room.

```
brand ──< model >── platform ──< platform_compat
            │
            └──< procedure_model_link >── procedure_model >── procedure
                                                                 │
            category ──────────────────────────────────────────<─┤
            procedure_step ────────────────────────────────────<─┤
            procedure_platform ────────────────────────────────<─┘
ecu ──< security_code_ecu >── security_code
dtc          obd_location          meta (schema_version, data_version)
```

Choix structurants :

- **Le modèle = la génération** (`Golf 7 (5G)` ≠ `Golf 8 (CD)`) : c'est la
  maille réelle de compatibilité VAG, chaque génération portant sa plateforme
  (`MQB`, `PQ35`, `MLB Evo`…).
- **Compatibilité par plateforme + marque**, pas par liste figée : une
  procédure déclare ses plateformes ; un véhicule accepte les procédures de sa
  marque dont la plateforme est couverte par `platform_compat`
  (`MQB Evo` → hérite de `MQB` ; `Tous` = joker). Les modèles explicitement
  cités (`procedure_model`) gardent le libellé éditorial pour l'affichage.
- **Ids stables** : les procédures conservent leur id numérique historique —
  les favoris/notes/codages d'origine stockés sur les téléphones des
  utilisateurs survivent à la migration. Marques/modèles/plateformes ont des
  slugs déterministes (`vw-golf-7-5g`).
- **Deux versions distinctes** : `schema_version` (structure, change avec le
  code) et `data_version` (contenu, change à chaque publication). Une donnée
  ne peut jamais avancer plus vite que le code qui l'interprète.

Correspondance Room (migration native future) : chaque table = une
`@Entity` (`brand` → `BrandEntity`, FK = `@ForeignKey`, index = `@Index`),
le pack JSON = le format d'échange réseau ; seul le module
`src/data/repository.js` serait à remplacer par des DAO.

## 3. Pourquoi un pack JSON + index mémoire (et pas SQLite embarqué) ?

Volumétrie actuelle : 435 procédures, 230 modèles, 107 DTC, 62 ECU,
26 codes d'accès → **pack de ~413 ko**, ~10 000 lignes logiques.

| Critère | Pack + index `Map` (retenu) | SQLite WebView (`@capacitor-community/sqlite`) |
|---|---|---|
| Lecture par id | O(1), ~µs | Pont JS↔natif : ~ms par requête |
| Démarrage | parse JSON ~50 ms + index ~10 ms | ouverture DB + plugin natif |
| Complexité | zéro dépendance native | plugin natif + wasm (web) + COOP/COEP |
| Seuil de confort | jusqu'à ~50 000 lignes | au-delà, et pour le FTS |

À ~50 000 lignes ou pour la recherche plein texte, on bascule : le schéma SQL
existe déjà, le `VcdsRepository` est la **seule** pièce à réimplémenter (même
interface), l'UI et le domaine ne bougent pas. C'est le bénéfice concret de la
Clean Architecture.

## 4. Les couches (Clean Architecture, lecture MVVM)

```
src/
├── domain/                  ← entités + règles pures (zéro dépendance)
│   ├── entities.js            typedefs, énumérations, normalisation
│   └── validatePack.js        intégrité référentielle (≈ FK/CHECK/UNIQUE)
├── data/                    ← accès aux données (Model de MVVM)
│   ├── config.js              URLs, clés de stockage
│   ├── storage.js             abstraction localStorage / mémoire / (Filesystem)
│   ├── sync.js                SyncService : manifest distant, sha256, rollback
│   ├── repository.js          VcdsRepository : index O(1) + compatibilité
│   ├── legacyViews.js         pack → formes attendues par l'UI v3
│   └── index.js               initVcdsData : orchestration offline-first
├── presentation/            ← UI (View + ViewModel)
│   ├── DataProvider.jsx       « ViewModel » racine : états loading/error/ready
│   └── uiConstants.js         couleurs, icônes, vocabulaire des filtres
├── App.jsx                  ← View (inchangée à 95 %)
└── data.js                  ← SOURCE ÉDITORIALE (plus jamais dans le bundle)

scripts/
├── build-datapack.mjs       ← CLI : data.js → public/data/{datapack,manifest}.json
├── lib/buildPack.mjs        ← normalisation + résolution des libellés
├── model-aliases.json       ← cas de résolution irréductibles (2 entrées)
└── data-version.json        ← version de contenu, à incrémenter à chaque publication
```

Le moteur de résolution (`buildPack.mjs`) convertit les libellés éditoriaux en
références relationnelles : `"Golf 5/6/7"` → 3 modèles, `"A4 (B8/B9)"` → 2,
`"Leon III (5F)"` → romain→arabe, `"Golf 7 TDI"` → retrait des qualificatifs,
`"Q5"` → toutes générations *filtrées par la plateforme de la procédure*,
`"Tous modèles diesel"` → joker + note d'audience. Résolution actuelle :
**100 % (0 libellé orphelin)**, garantie par la CI.

## 5. Offline-first et synchronisation sans Play Store

```
Démarrage app
   │ 1. pack STOCKÉ (sync précédente) ───────────┐ le plus récent
   │ 2. pack EMBARQUÉ (./data/, généré au build) ┘ des deux gagne
   ▼
UI affichée (jamais bloquée par le réseau)
   │ 3. en arrière-plan : GET manifest.json (GitHub Pages)
   ▼
dataVersion distante > locale ?
   ├─ non → terminé (up-to-date)
   └─ oui → GET datapack.json
             ├─ sha256 ≠ manifest      → REJET (base locale intacte)
             ├─ validatePack() échoue  → REJET (base locale intacte)
             └─ OK → installation atomique + bascule à chaud de l'UI
```

**Publier une mise à jour de données** (zéro release Play Store) :

1. Éditer `src/data.js` (ou ajouter un alias dans `scripts/model-aliases.json`).
2. Incrémenter `dataVersion` dans `scripts/data-version.json`.
3. `npm test` puis push sur `main` → les workflows existants régénèrent le pack
   (le build **échoue** si la donnée est incohérente) et Pages sert le nouveau
   `manifest.json`.
4. Les apps installées détectent et installent la mise à jour au prochain
   démarrage. Une APK fraîchement installée a toujours le pack du build dans
   ses assets : le premier lancement fonctionne 100 % hors ligne.

Cas gérés : réseau coupé (`offline`, silencieux), pack falsifié/corrompu
(`error`, rollback), schéma distant trop récent (`app-update-required`,
affiché dans Réglages), stockage saturé/interdit (échec silencieux, retombée
sur le pack embarqué).

## 6. Validation à trois niveaux & matrice de vérification

Le même validateur (`validatePack`) s'exécute : **au build** (CI bloquante),
**au runtime** (pack distant rejeté si invalide, repository qui refuse un pack
incohérent), **dans les tests**.

| Module | Testé par | Cas d'erreurs couverts |
|---|---|---|
| `domain/validatePack.js` | `tests/validatePack.test.js` (21 tests) | refs inconnues, doublons, énumérations, étapes non contiguës, **modèle d'une autre marque sur une procédure**, années incohérentes |
| `scripts/lib/buildPack.mjs` | `tests/buildPack.test.js` (11 tests) | 0 référence orpheline sur la base réelle, alias morts, dédup codes d'accès/DTC, ids stables, déterminisme à l'octet, data.js hors bundle |
| `data/repository.js` | `tests/repository.test.js` (15 tests) | **Golf 7 ↛ codage A3 8L** (et réciproque), isolation de marques, héritage MQB→MQB Evo, joker `Tous`, véhicule inconnu sans exception, recherche |
| `data/sync.js` + `data/index.js` | `tests/sync.test.js` (14 tests) | sha256 falsifié, JSON corrompu, pack invalide, schéma futur, hors ligne, version identique (pas de téléchargement), démarrage sans aucune donnée |

Le schéma SQL lui-même est exécutable et contraint : `node -e` avec
`node:sqlite` charge `db/schema.sql` (18 tables), rejette une insertion
orpheline (FK) et une gravité hors énumération (CHECK).

`npm test` : 61 tests. `npm run validate:data` : audit d'intégrité seul.

## 7. Évolutions prévues (sans refonte)

- **Recherche plein texte** : FTS5 (voir bas de `schema.sql`) le jour où la
  recherche `includes()` devient lente.
- **Variantes de calculateurs par modèle** (firmware/index matériel) : table
  `model_ecu` esquissée dans le schéma ; ajouter l'entité au pack + une règle
  au validateur quand la donnée éditoriale existera.
- **Pack distant ≠ pack embarqué** : le manifest accepte déjà n'importe quel
  `file` — un futur backend peut publier des packs sans toucher à l'app.
- **Multi-langue** : dupliquer les colonnes de texte (`title_fr`, `title_en`)
  ou servir un pack par langue (`manifest-en.json`).

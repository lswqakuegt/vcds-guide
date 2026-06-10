-- ═══════════════════════════════════════════════════════════════════════════
-- SCHÉMA RELATIONNEL CANONIQUE — Base de données VCDS (groupe VAG)
-- ═══════════════════════════════════════════════════════════════════════════
-- Ce fichier est la RÉFÉRENCE du modèle de données. Il est directement
-- exécutable sur SQLite, et chaque table correspond 1:1 à une @Entity Room
-- (voir docs/ARCHITECTURE.md §7 pour la correspondance Room/Kotlin).
--
-- Le data pack JSON consommé par l'application (public/data/datapack.json)
-- est la sérialisation de ce schéma : mêmes entités, mêmes clés, mêmes
-- contraintes — validées par src/domain/validatePack.js.
--
-- ── Vérification ────────────────────────────────────────────────────────────
-- · Intégrité : toutes les FK sont déclarées (PRAGMA foreign_keys = ON).
-- · Énumérations gardées par CHECK (difficulté, gravité).
-- · Test : `sqlite3 :memory: < db/schema.sql` doit s'exécuter sans erreur.
-- · Les mêmes règles sont appliquées côté JS par validatePack() — un pack
--   qui passe le validateur peut être inséré ici sans violation de contrainte.
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;

-- Métadonnées de version du pack (une seule ligne).
-- schema_version : version du SCHÉMA (incompatibilités structurelles).
-- data_version   : version du CONTENU (incrémentée à chaque publication).
CREATE TABLE meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  data_version   INTEGER NOT NULL,
  generated_at   TEXT
);

-- ── Référentiel véhicules ────────────────────────────────────────────────────

CREATE TABLE brand (
  id     TEXT PRIMARY KEY,          -- slug stable : 'volkswagen', 'audi'…
  name   TEXT NOT NULL UNIQUE,      -- 'Volkswagen'
  short  TEXT NOT NULL,             -- 'VW'
  color1 TEXT,                      -- couleurs de l'écran d'accueil
  color2 TEXT
);

-- Plateforme technique VAG (MQB, PQ35, MLB Evo…). La compatibilité des
-- procédures se calcule par plateforme : un véhicule MQB Evo accepte les
-- procédures MQB. 'Tous' est une plateforme sentinelle (jokers).
CREATE TABLE platform (
  id   TEXT PRIMARY KEY,            -- slug : 'mqb', 'mqb-evo', 'pq35', 'tous'
  name TEXT NOT NULL UNIQUE         -- 'MQB', 'MQB Evo'…
);

-- Plateformes de procédures acceptées par une plateforme véhicule.
-- Ex. (mqb-evo → mqb), (mqb-evo → mqb-evo), (toutes → tous).
CREATE TABLE platform_compat (
  vehicle_platform_id   TEXT NOT NULL REFERENCES platform(id),
  procedure_platform_id TEXT NOT NULL REFERENCES platform(id),
  PRIMARY KEY (vehicle_platform_id, procedure_platform_id)
);

-- Un modèle = une génération précise (Golf 7 (5G) ≠ Golf 8 (CD)).
-- C'est la maille à laquelle se rattachent compatibilités et procédures.
CREATE TABLE model (
  id          TEXT PRIMARY KEY,     -- slug stable : 'vw-golf-7-5g'
  brand_id    TEXT NOT NULL REFERENCES brand(id),
  platform_id TEXT NOT NULL REFERENCES platform(id),
  name        TEXT NOT NULL,        -- 'Golf 7 (5G)'
  years_label TEXT NOT NULL,        -- '2012–2020' (affichage)
  year_from   INTEGER,              -- 2012 (requêtes)
  year_to     INTEGER,              -- 2020, NULL = toujours produit
  UNIQUE (brand_id, name)
);
CREATE INDEX idx_model_brand    ON model(brand_id);
CREATE INDEX idx_model_platform ON model(platform_id);

-- Codes châssis d'un modèle ('5G', '8V'…) — sert à la résolution des
-- références textuelles et à la recherche.
CREATE TABLE model_chassis_code (
  model_id TEXT NOT NULL REFERENCES model(id),
  code     TEXT NOT NULL,
  PRIMARY KEY (model_id, code)
);
CREATE INDEX idx_chassis_code ON model_chassis_code(code);

-- ── Calculateurs (ECU) ───────────────────────────────────────────────────────

CREATE TABLE ecu (
  address     TEXT PRIMARY KEY,     -- adresse VCDS : '01', '09', '5F'…
  name        TEXT NOT NULL,        -- 'Centrale électrique (BCM)'
  description TEXT NOT NULL
);

-- ── Codes d'accès (Security Access) ─────────────────────────────────────────

CREATE TABLE security_code (
  code  TEXT PRIMARY KEY,           -- '20103'
  usage TEXT NOT NULL               -- description d'usage
);

-- Un code d'accès peut concerner plusieurs calculateurs (20103 → 09,16,17…).
CREATE TABLE security_code_ecu (
  security_code TEXT NOT NULL REFERENCES security_code(code),
  ecu_address   TEXT NOT NULL REFERENCES ecu(address),
  PRIMARY KEY (security_code, ecu_address)
);

-- ── Procédures de codage ─────────────────────────────────────────────────────

CREATE TABLE category (
  id   TEXT PRIMARY KEY,            -- slug : 'eclairage'
  name TEXT NOT NULL UNIQUE,        -- 'Éclairage'
  icon TEXT
);

CREATE TABLE procedure (
  id             INTEGER PRIMARY KEY,  -- id numérique STABLE (favoris/notes
                                       -- des utilisateurs pointent dessus)
  brand_id       TEXT NOT NULL REFERENCES brand(id),
  category_id    TEXT NOT NULL REFERENCES category(id),
  title          TEXT NOT NULL,        -- 'Désactiver le Start & Stop'
  difficulty     TEXT NOT NULL CHECK (difficulty IN ('Facile','Moyenne','Avancée')),
  explanation    TEXT,                 -- 'à quoi ça sert', vulgarisé
  note           TEXT,                 -- avertissements, cas particuliers
  applies_to_all INTEGER NOT NULL DEFAULT 0,  -- 1 = 'Tous modèles…'
  audience_note  TEXT                  -- qualificatif : 'diesel', 'DSG'…
);
CREATE INDEX idx_procedure_brand    ON procedure(brand_id);
CREATE INDEX idx_procedure_category ON procedure(category_id);

CREATE TABLE procedure_step (
  procedure_id INTEGER NOT NULL REFERENCES procedure(id),
  step_number  INTEGER NOT NULL,
  instruction  TEXT NOT NULL,
  PRIMARY KEY (procedure_id, step_number)
);

-- Plateformes sur lesquelles la procédure s'applique ('tous' = joker).
CREATE TABLE procedure_platform (
  procedure_id INTEGER NOT NULL REFERENCES procedure(id),
  platform_id  TEXT NOT NULL REFERENCES platform(id),
  PRIMARY KEY (procedure_id, platform_id)
);

-- Modèles explicitement validés pour la procédure. `label` conserve le
-- libellé éditorial d'origine ('Golf 7 TDI') ; un libellé peut se résoudre
-- vers plusieurs modèles ('Golf 5/6/7' → 3 lignes de procedure_model_link).
CREATE TABLE procedure_model (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id INTEGER NOT NULL REFERENCES procedure(id),
  label        TEXT NOT NULL
);
CREATE INDEX idx_procmodel_proc ON procedure_model(procedure_id);

CREATE TABLE procedure_model_link (
  procedure_model_id INTEGER NOT NULL REFERENCES procedure_model(id),
  model_id           TEXT NOT NULL REFERENCES model(id),
  PRIMARY KEY (procedure_model_id, model_id)
);
CREATE INDEX idx_procmodellink_model ON procedure_model_link(model_id);

-- Codes d'accès cités par la procédure. `label` garde le texte d'origine
-- ('20113 (pour A6 C7, calculateur 09)'), `security_code` la référence
-- normalisée quand elle est résoluble.
CREATE TABLE procedure_security_code (
  procedure_id  INTEGER NOT NULL REFERENCES procedure(id),
  label         TEXT NOT NULL,
  security_code TEXT REFERENCES security_code(code),
  PRIMARY KEY (procedure_id, label)
);

-- ── Codes défauts (DTC) ──────────────────────────────────────────────────────

CREATE TABLE dtc (
  code     TEXT PRIMARY KEY,        -- 'P0420' ou code VAG 5 chiffres '00778'
  title    TEXT NOT NULL,
  causes   TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Faible','Moyen','Grave'))
);

-- ── Emplacements de prise OBD ───────────────────────────────────────────────

CREATE TABLE obd_location (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id     TEXT NOT NULL REFERENCES brand(id),
  models_label TEXT NOT NULL,       -- 'Golf 5 (1K), Golf 6 (5K)'
  location     TEXT NOT NULL
);

-- ── Pistes d'évolution (volumétrie > ~50 000 lignes) ────────────────────────
-- · Recherche plein texte :
--     CREATE VIRTUAL TABLE procedure_fts USING fts5(title, explanation, note,
--       content='procedure', content_rowid='id');
-- · Variantes de calculateurs par modèle (firmware, index matériel) :
--     table model_ecu(model_id, ecu_address, hw_index, fw_range) — prévue,
--     non peuplée tant que la donnée éditoriale n'existe pas.

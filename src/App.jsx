import { useState, useMemo } from "react";
import "./styles.css";
import {
  CATEGORIES, MARQUES, MARQUE_LOGO, MARQUES_ACCUEIL,
  DIFF_COLOR, CATEGORIE_ICON, GRAVITE_COLOR,
} from "./presentation/uiConstants.js";
import { useVcdsData } from "./presentation/DataProvider.jsx";
import InstallBanner from "./presentation/InstallBanner.jsx";

const useStored = (key, init) => {
  const [v, setV] = useState(() => { try { const r = localStorage.getItem(key); return r !== null ? JSON.parse(r) : init; } catch { return init; } });
  return [v, (nv) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch {} }];
};

export default function App() {
  const {
    DB, EXPLICATIONS, CALCULATEURS, CODES_ACCES_INDEX, CODES_DEFAUTS,
    OBD_LOCATIONS, VEHICULES, PLAT_COMPAT, dataMeta, syncInfo,
  } = useVcdsData();
  const [theme, setTheme] = useStored("vcds.theme", "dark");
  const [favs, setFavs] = useStored("vcds.favoris", []);
  const [notes, setNotes] = useStored("vcds.notes", {});
  const [garage, setGarage] = useStored("vcds.garage", { marque: "", modele: "", annee: "", vin: "", modifsFaites: [], codagesOrigine: {} });

  const [vue, setVue] = useState("accueil");
  const [q, setQ] = useState("");
  const [fMarque, setFMarque] = useState("Toutes");
  const [fCat, setFCat] = useState("Toutes");
  const [fVehicule, setFVehicule] = useState("");
  const [sel, setSel] = useState(null);
  const [qDtc, setQDtc] = useState("");
  const [qCalc, setQCalc] = useState("");
  const [reading, setReading] = useState(null);

  const cntMarque = useMemo(() => { const c = { Volkswagen: 0, Audi: 0, Seat: 0, Skoda: 0 }; DB.forEach(i => { if (c[i.marque] !== undefined) c[i.marque]++; }); return c; }, [DB]);
  const cntCat = useMemo(() => { const c = {}; CATEGORIES.forEach(cat => { c[cat] = cat === "Toutes" ? DB.length : DB.filter(i => i.categorie === cat).length; }); return c; }, [DB]);
  const vehiculesFiltered = useMemo(() => {
    const list = fMarque === "Toutes" ? VEHICULES : VEHICULES.filter(v => v.marque === fMarque);
    return [...list].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [fMarque, VEHICULES]);

  const go = (v) => { setVue(v); setSel(null); };
  const goMarque = (m) => { setFMarque(m); setFCat("Toutes"); setFVehicule(""); setQ(""); setSel(null); setVue("liste"); };
  const toggleFav = (id) => { const s = new Set(favs); s.has(id) ? s.delete(id) : s.add(id); setFavs([...s]); };
  const toggleDone = (id) => { const a = garage.modifsFaites || []; setGarage({ ...garage, modifsFaites: a.includes(id) ? a.filter(x => x !== id) : [...a, id] }); };

  const share = async (item) => {
    const t = [`VCDS — ${item.fonction}`, "", `${item.marque} · ${item.modeles.join(", ")}`, ""];
    if (EXPLICATIONS[item.id]) t.push(EXPLICATIONS[item.id], "");
    item.chemin.forEach(s => t.push(`${s.etape}. ${s.action}`));
    if (item.note) t.push("", item.note);
    const txt = t.join("\n");
    try { if (navigator.share) await navigator.share({ title: item.fonction, text: txt }); else if (navigator.clipboard) { await navigator.clipboard.writeText(txt); alert("Copie !"); } } catch {}
  };

  const speak = (item) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (reading === item.id) { setReading(null); return; }
    setReading(item.id);
    const ph = [item.fonction, EXPLICATIONS[item.id] || "", ...item.chemin.map(s => `Etape ${s.etape}. ${s.action}`)].filter(Boolean);
    ph.forEach((txt, i) => { const u = new SpeechSynthesisUtterance(txt); u.lang = "fr-FR"; u.rate = .92; if (i === ph.length - 1) u.onend = () => setReading(null); window.speechSynthesis.speak(u); });
  };

  const xport = () => { const b = new Blob([JSON.stringify({ favs, notes, garage, theme, v: 3 }, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: "vcds-backup.json" }).click(); URL.revokeObjectURL(u); };
  const mport = () => { const inp = Object.assign(document.createElement("input"), { type: "file", accept: ".json" }); inp.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (d.favs) setFavs(d.favs); if (d.notes) setNotes(d.notes); if (d.garage) setGarage(d.garage); if (d.theme) setTheme(d.theme); alert("OK !"); } catch { alert("Erreur"); } }; r.readAsText(f); }; inp.click(); };

  const filtered = useMemo(() => {
    const selVeh = fVehicule ? VEHICULES.find(v => v.nom === fVehicule) : null;
    return DB.filter(i => {
      const s = q.toLowerCase();
      const matchQ = !s || i.fonction.toLowerCase().includes(s) || i.categorie.toLowerCase().includes(s) || i.modeles.join(" ").toLowerCase().includes(s) || i.marque.toLowerCase().includes(s) || i.plateforme.toLowerCase().includes(s) || (EXPLICATIONS[i.id] || "").toLowerCase().includes(s);
      const matchMarque = fMarque === "Toutes" || i.marque === fMarque;
      const matchCat = fCat === "Toutes" || i.categorie === fCat;
      let matchVeh = true;
      if (selVeh) {
        const procPlats = i.plateforme.split(/[\/,]/).map(p => p.trim());
        const vehCompat = PLAT_COMPAT[selVeh.plat] || [];
        const platOk = procPlats.includes("Tous") || procPlats.some(pp => vehCompat.includes(pp));
        const marqueOk = i.marque === selVeh.marque;
        matchVeh = platOk && marqueOk;
      }
      return matchQ && matchMarque && matchCat && matchVeh;
    });
  }, [q, fMarque, fCat, fVehicule, DB, VEHICULES, PLAT_COMPAT, EXPLICATIONS]);

  const favList = useMemo(() => DB.filter(i => favs.includes(i.id)), [favs, DB]);
  const dtcF = useMemo(() => { const s = qDtc.toLowerCase(); return !s ? CODES_DEFAUTS : CODES_DEFAUTS.filter(d => d.code.toLowerCase().includes(s) || d.nom.toLowerCase().includes(s) || d.cause.toLowerCase().includes(s)); }, [qDtc, CODES_DEFAUTS]);
  const calcF = useMemo(() => { const s = qCalc.toLowerCase(); return !s ? CALCULATEURS : CALCULATEURS.filter(c => c.code.toLowerCase().includes(s) || c.nom.toLowerCase().includes(s) || c.desc.toLowerCase().includes(s)); }, [qCalc, CALCULATEURS]);

  const Hdr = ({ t: titre, s: sub }) => (
    <div className="hdr"><div className="hdr-in">
      <div className="hdr-back" onClick={() => go("accueil")}>←</div>
      <div><div className="hdr-t">{titre}</div>{sub && <div className="hdr-s">{sub}</div>}</div>
    </div></div>
  );

  const Nav = () => (
    <div className="bnav"><div className="bnav-in">
      {[["accueil","🏠","Accueil"],["liste","📋","Procedures"],["favoris","★","Favoris"],["garage","🚗","Garage"],["parametres","⚙️","Reglages"]].map(([id,ic,lb]) => (
        <div key={id} className={`ni ${vue===id?"on":""}`} onClick={() => go(id)}>
          <span className="ni-i">{ic}</span><span className="ni-l">{lb}</span>
        </div>
      ))}
    </div></div>
  );

  const Card = ({ item }) => {
    const dc = DIFF_COLOR[item.difficulte];
    const open = sel === item.id;
    const fav = favs.includes(item.id);
    const done = garage.modifsFaites?.includes(item.id);
    return (
      <div className={`cd ${open ? "op" : ""}`}>
        <div className="cd-h" onClick={() => setSel(open ? null : item.id)}>
          <span className="cd-logo">{MARQUE_LOGO[item.marque]}</span>
          <div className="cd-body">
            <div className="cd-title">{item.fonction}</div>
            <div className="cd-tags">
              <span className="tg">{item.marque}</span>
              <span className="tg">{CATEGORIE_ICON[item.categorie] || ""} {item.categorie}</span>
              <span className="tg tg-d" style={{ background: dc.bg, color: dc.text, borderColor: dc.border }}>
                <span className="tg-dot" style={{ background: dc.dot }} />{item.difficulte}
              </span>
            </div>
            <div className="cd-mod">{item.modeles.join(" · ")}</div>
          </div>
          <span className={`cd-fav ${fav?"y":"n"}`} onClick={e => { e.stopPropagation(); toggleFav(item.id); }}>{fav ? "★" : "☆"}</span>
          <span className="cd-arr">▼</span>
        </div>
        {open && (
          <div className="cd-det">
            {EXPLICATIONS[item.id] && <div className="expl"><div className="expl-l">A QUOI CA SERT</div><div className="expl-t">{EXPLICATIONS[item.id]}</div></div>}
            <div className="acts">
              <button className="bt" onClick={() => share(item)}>Partager</button>
              <button className={`bt ${reading===item.id?"on":""}`} onClick={() => speak(item)}>{reading===item.id ? "Stop" : "Lire"}</button>
              <button className={`bt ${done?"ok":""}`} onClick={() => toggleDone(item.id)}>{done ? "Fait ✓" : "A faire"}</button>
            </div>
            <div className="sl">MODELES COMPATIBLES</div>
            <div className="mchips mb14">{item.modeles.map(m => <span key={m} className="mch">{m}</span>)}</div>
            <div className="sl">ETAPES</div>
            <div className="steps">{item.chemin.map((s,i) => <div key={i} className="stp"><div className="stp-n">{s.etape}</div><div className="stp-t">{s.action}</div></div>)}</div>
            {item.note && <div className="nb">{item.note}</div>}
            {item.codesAcces.length > 0 && <><div className="sl">CODES D'ACCES</div><div className="cbdg mb14">{item.codesAcces.map(c => <span key={c} className="cbd">{c}</span>)}</div></>}
            <div className="sl">CODAGE D'ORIGINE</div>
            <textarea className="dta co" value={garage.codagesOrigine?.[item.id] || ""} onChange={e => setGarage({ ...garage, codagesOrigine: { ...(garage.codagesOrigine||{}), [item.id]: e.target.value } })} placeholder="Valeur d'origine..." onClick={e => e.stopPropagation()} rows={2} />
            <div className="sl">MES NOTES</div>
            <textarea className="dta" value={notes[item.id] || ""} onChange={e => setNotes({ ...notes, [item.id]: e.target.value })} placeholder="Notes personnelles..." onClick={e => e.stopPropagation()} rows={2} />
            <div className="dm">Plateforme {item.plateforme} · #{item.id.toString().padStart(3,"0")}</div>
          </div>
        )}
      </div>
    );
  };

  // ─── ACCUEIL ──────────────────────────────────────────────
  if (vue === "accueil") {
    const tools = [
      { id:"codesAcces", n:"Codes d'acces", i:"🔑", c1:"#92400e", c2:"#d97706", d:`${CODES_ACCES_INDEX.length} codes` },
      { id:"calculateurs", n:"Calculateurs", i:"🎛️", c1:"#312e81", c2:"#6366f1", d:`${CALCULATEURS.length} ECU` },
      { id:"codesDefauts", n:"Codes defauts", i:"🚨", c1:"#7f1d1d", c2:"#ef4444", d:`${CODES_DEFAUTS.length} DTC` },
      { id:"obd", n:"Prise OBD", i:"📍", c1:"#164e63", c2:"#06b6d4", d:`${OBD_LOCATIONS.length} modeles` },
    ];
    return (
      <div className="app" data-theme={theme}>
        <div className="home">
          <div className="home-logo">
            <div className="logo-i">🔧</div>
            <div className="logo-t">VCDS</div>
            <div className="logo-s">VW · AUDI · SEAT · SKODA</div>
            <div className="logo-st">{DB.length} procedures · {CODES_DEFAUTS.length} DTC · {CALCULATEURS.length} ECU</div>
          </div>
          <div className="sec-l">MARQUES</div>
          <div className="bgrid">
            {MARQUES_ACCUEIL.map(m => (
              <div key={m.nom} className="bcard" style={{ background:`linear-gradient(135deg,${m.couleur},${m.couleur2})`, boxShadow:`0 6px 20px ${m.couleur}55` }} onClick={() => goMarque(m.nom)}>
                <div className="bcard-e">{MARQUE_LOGO[m.nom]}</div>
                <div className="bcard-n">{m.court}</div>
                <div className="bcard-c">{cntMarque[m.nom]} procedures</div>
              </div>
            ))}
          </div>
          <div className="sec-l">OUTILS</div>
          <div className="tgrid">
            {tools.map(t => (
              <div key={t.id} className="tcard" style={{ background:`linear-gradient(135deg,${t.c1},${t.c2})`, boxShadow:`0 4px 14px ${t.c1}44` }} onClick={() => go(t.id)}>
                <div className="tcard-i">{t.i}</div>
                <div className="tcard-n">{t.n}</div>
                <div className="tcard-d">{t.d}</div>
              </div>
            ))}
          </div>
          <InstallBanner />
        </div>
        <Nav />
      </div>
    );
  }

  // ─── FAVORIS ──────────────────────────────────────────────
  if (vue === "favoris") return (
    <div className="app" data-theme={theme}>
      <Hdr t="Favoris" s={`${favList.length} procedure${favList.length>1?"s":""}`} />
      <div className="ct">{favList.length===0 ? <div className="empty">Aucun favori.<br/>Appuie sur ☆ pour en ajouter.</div> : <div className="lst">{favList.map(i => <Card key={i.id} item={i} />)}</div>}</div>
      <Nav />
    </div>
  );

  // ─── GARAGE ───────────────────────────────────────────────
  if (vue === "garage") {
    const done = garage.modifsFaites || [];
    const pDone = DB.filter(i => done.includes(i.id));
    return (
      <div className="app" data-theme={theme}>
        <Hdr t="Mon garage" s={garage.marque ? `${garage.marque} ${garage.modele}` : "Configure ton vehicule"} />
        <div className="ct">
          <div className="scard">
            <div className="scard-l">MON VEHICULE</div>
            {[["marque","Marque","Volkswagen"],["modele","Modele","Golf 7 GTI"],["annee","Annee","2018"],["vin","VIN","WVW..."]].map(([k,l,p]) => (
              <div key={k} className="fg"><label className="fl">{l}</label><input className="fi" value={garage[k]||""} onChange={e => setGarage({...garage,[k]:e.target.value})} placeholder={p} /></div>
            ))}
          </div>
          <div className="stats">
            <div><div className="st-v">{done.length}</div><div className="st-l">MODIFS</div></div>
            <div><div className="st-v">{Object.keys(garage.codagesOrigine||{}).length}</div><div className="st-l">CODAGES</div></div>
            <div><div className="st-v">{favs.length}</div><div className="st-l">FAVORIS</div></div>
          </div>
          <div className="sec-l mb8">MODIFICATIONS EFFECTUEES</div>
          {pDone.length===0 ? <div className="empty">Aucune modif.</div> : <div className="lst">{pDone.map(i => <Card key={i.id} item={i} />)}</div>}
        </div>
        <Nav />
      </div>
    );
  }

  // ─── CODES D'ACCES ────────────────────────────────────────
  if (vue === "codesAcces") return (
    <div className="app" data-theme={theme}>
      <Hdr t="Codes d'acces" s={`${CODES_ACCES_INDEX.length} Security Access`} />
      <div className="ct"><div className="lst">{CODES_ACCES_INDEX.map((c,i) => (
        <div key={`${c.code}-${i}`} className="rc">
          <div className="rc-h"><span className="rc-code">{c.code}</span><span className="rc-badge">Calc. {c.calculateur}</span></div>
          <div className="rc-d">{c.usage}</div>
        </div>
      ))}</div></div>
      <Nav />
    </div>
  );

  // ─── CALCULATEURS ─────────────────────────────────────────
  if (vue === "calculateurs") return (
    <div className="app" data-theme={theme}>
      <Hdr t="Calculateurs" s={`${calcF.length} / ${CALCULATEURS.length} ECU`} />
      <div className="ct">
        <div className="sb mb14"><span className="si-ico">🔍</span><input className="si" value={qCalc} onChange={e => setQCalc(e.target.value)} placeholder="Rechercher (moteur, 09, BCM...)" /></div>
        <div className="lst">{calcF.map((c,i) => (
          <div key={`${c.code}-${i}`} className="rc ecu">
            <div className="ecu-c">{c.code}</div>
            <div className="ecu-b"><div className="rc-t">{c.nom}</div><div className="rc-d">{c.desc}</div></div>
          </div>
        ))}</div>
      </div>
      <Nav />
    </div>
  );

  // ─── CODES DEFAUTS ────────────────────────────────────────
  if (vue === "codesDefauts") return (
    <div className="app" data-theme={theme}>
      <Hdr t="Codes defauts" s={`${dtcF.length} / ${CODES_DEFAUTS.length} DTC`} />
      <div className="ct">
        <div className="sb mb14"><span className="si-ico">🔍</span><input className="si" value={qDtc} onChange={e => setQDtc(e.target.value)} placeholder="Rechercher (P0420, turbo, 00778...)" /></div>
        <div className="lst">{dtcF.map((d,i) => {
          const gc = GRAVITE_COLOR[d.gravite];
          return (
            <div key={`${d.code}-${i}`} className="rc">
              <div className="rc-h">
                <span className="rc-code">{d.code}</span>
                <span className="sev" style={{ background:gc.bg, color:gc.text, border:`1px solid ${gc.border}` }}>{d.gravite}</span>
              </div>
              <div className="rc-t">{d.nom}</div>
              <div className="rc-d">{d.cause}</div>
            </div>
          );
        })}</div>
      </div>
      <Nav />
    </div>
  );

  // ─── OBD ──────────────────────────────────────────────────
  if (vue === "obd") {
    const pm = {}; OBD_LOCATIONS.forEach(o => { (pm[o.marque] = pm[o.marque] || []).push(o); });
    return (
      <div className="app" data-theme={theme}>
        <Hdr t="Prise OBD" s={`${OBD_LOCATIONS.length} modeles`} />
        <div className="ct">
          <div className="nb mb16">La prise OBD-II (16 broches) est toujours cote conducteur, sous le volant, derriere un cache plastique.</div>
          {Object.entries(pm).map(([mk,locs]) => (
            <div key={mk} className="mb20">
              <div className="obd-mh"><span className="obd-e">{MARQUE_LOGO[mk]}</span><span className="obd-n">{mk.toUpperCase()}</span></div>
              <div className="lst">{locs.map((o,i) => <div key={i} className="rc"><div className="rc-t">{o.modeles}</div><div className="rc-d">{o.location}</div></div>)}</div>
            </div>
          ))}
        </div>
        <Nav />
      </div>
    );
  }

  // ─── PARAMETRES ───────────────────────────────────────────
  if (vue === "parametres") return (
    <div className="app" data-theme={theme}>
      <Hdr t="Parametres" />
      <div className="ct">
        <div className="scard">
          <div className="scard-l">THEME</div>
          <div className="thbtns">
            <button className={`thb ${theme==="dark"?"on":""}`} onClick={() => setTheme("dark")}>Sombre</button>
            <button className={`thb ${theme==="light"?"on":""}`} onClick={() => setTheme("light")}>Clair</button>
          </div>
        </div>
        <div className="scard">
          <div className="scard-l">APPLICATION</div>
          <InstallBanner variant="settings" />
        </div>
        <div className="scard">
          <div className="scard-l">DONNEES</div>
          <div className="di">{favs.length} favoris · {(garage.modifsFaites||[]).length} modifs · {Object.keys(garage.codagesOrigine||{}).length} codages · {Object.keys(notes).length} notes</div>
          <div className="brow"><button className="bt wf" onClick={xport}>Exporter</button><button className="bt wf" onClick={mport}>Importer</button></div>
          <button className="bt bt-del wf" onClick={() => { if(confirm("Effacer toutes les donnees ?")) { setFavs([]); setNotes({}); setGarage({ marque:"",modele:"",annee:"",vin:"",modifsFaites:[],codagesOrigine:{} }); } }}>Tout effacer</button>
        </div>
        <div className="scard">
          <div className="scard-l">A PROPOS</div>
          <div className="rc-d"><strong style={{color:"var(--t1)"}}>VCDS</strong> v3.0 — {DB.length} procedures · {CODES_DEFAUTS.length} DTC · {CALCULATEURS.length} ECU<br/>VW · Audi · Seat · Skoda</div>
          <div className="rc-d" style={{marginTop:6}}>
            Base de donnees v{dataMeta.dataVersion} ({dataMeta.source === "remote" ? "synchronisee" : "embarquee"})
            {syncInfo.status === "updated" && " · mise a jour appliquee"}
            {syncInfo.status === "up-to-date" && " · a jour"}
            {syncInfo.status === "offline" && " · hors ligne"}
            {syncInfo.status === "app-update-required" && " · nouvelle base disponible, mettre a jour l'app"}
          </div>
        </div>
      </div>
      <Nav />
    </div>
  );

  // ─── LISTE ────────────────────────────────────────────────
  return (
    <div className="app" data-theme={theme}>
      <Hdr t="Procedures" s={fMarque==="Toutes" ? "VW · AUDI · SEAT · SKODA" : fMarque.toUpperCase()} />
      <div className="ct">
        <div className="sb"><span className="si-ico">🔍</span><input className="si" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (start stop, Golf 7, turbo...)" /></div>
        <div className="chips">
          {CATEGORIES.map(cat => <span key={cat} className={`ch ${fCat===cat?"on":""}`} onClick={() => setFCat(cat)}>{CATEGORIE_ICON[cat]||""} {cat} ({cntCat[cat]||0})</span>)}
        </div>
        <div className="frow">
          <select className="fsel" value={fMarque} onChange={e => { setFMarque(e.target.value); setFVehicule(""); }}>
            {MARQUES.map(o => <option key={o}>{o}</option>)}
          </select>
          <select className="fsel" value={fVehicule} onChange={e => setFVehicule(e.target.value)}>
            <option value="">Tous les modeles</option>
            {vehiculesFiltered.map(v => (
              <option key={`${v.nom}-${v.marque}`} value={v.nom}>{v.nom} · {v.annees}</option>
            ))}
          </select>
        </div>
        <div className="rcnt">{filtered.length} / {DB.length} procedures</div>
        {filtered.length===0 ? <div className="empty">Aucun resultat</div> : <div className="lst">{filtered.map(i => <Card key={i.id} item={i} />)}</div>}
        <div className="footer">Toujours sauvegarder le codage d'origine · VCDS v3.0</div>
      </div>
      <Nav />
    </div>
  );
}

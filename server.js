const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-me";

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 180 }));

let usingPostgres = Boolean(DATABASE_URL);
let pool = null;
if (usingPostgres) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

app.use(session({
  store: usingPostgres ? new (require("connect-pg-simple")(session))({ pool, createTableIfMissing: true }) : undefined,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const memory = { libraries: [], users: [], events: [], games: [], applications: [], announcements: [], surveys: [] };

function futureDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
async function hash(p) { return bcrypt.hash(p, 10); }
async function compare(p, h) { return bcrypt.compare(p, h); }
async function query(sql, params = []) { const res = await pool.query(sql, params); return res.rows; }

async function initMemory() {
  const adminPass = await hash("123456");
  const libPass = await hash("123456");
  memory.libraries = [
    { id: 1, name: "Adıyaman Yeşilyurt Halk Kütüphanesi", slug: "yesilyurt", email: "yesilyurt@ktb.gov.tr", phone: "0416 000 00 00", address: "Yeşilyurt Mah. 2131 Sok. No:5 Merkez / ADIYAMAN", about: "Çocuk, genç ve yetişkin kullanıcılar için etkinlik, okuma, çalışma ve zeka oyunları hizmetleri sunan halk kütüphanesi.", working_hours: "Hafta içi 08:00 - 19:00", score: 92, rank_name: "Lider", status: "approved", logo_pos_x: 50, logo_pos_y: 50, logo_zoom: 1.15, banner_pos_x: 50, banner_pos_y: 50 },
    { id: 2, name: "Serik Halk Kütüphanesi", slug: "serik", email: "serik@ktb.gov.tr", phone: "0242 000 00 00", address: "Serik / ANTALYA", about: "Etkinlik ve zeka oyunları odaklı demo kütüphane.", working_hours: "09:00 - 18:00", score: 76, rank_name: "Üreten", status: "approved", logo_pos_x: 50, logo_pos_y: 50, logo_zoom: 1.15, banner_pos_x: 50, banner_pos_y: 50 }
  ];
  memory.users = [
    { id: 1, email: "admin@ktb.gov.tr", password_hash: adminPass, role: "SUPER_ADMIN", library_id: null, active: true },
    { id: 2, email: "yesilyurt@ktb.gov.tr", password_hash: libPass, role: "LIBRARY_ADMIN", library_id: 1, active: true },
    { id: 3, email: "serik@ktb.gov.tr", password_hash: libPass, role: "LIBRARY_ADMIN", library_id: 2, active: true }
  ];
  memory.announcements = [
    { id: 1, library_id: 1, type: "library", title: "Etkinlik başvuruları açıldı", body: "Çocuk etkinlikleri için başvurular başlamıştır.", active: true },
    { id: 2, library_id: null, type: "global", title: "Platform yayında", body: "Dijital Kütüphane Platformu demo sürümü yayındadır.", active: true }
  ];
  let id = 1;
  for (const lib of memory.libraries) {
    for (let i = 1; i <= 30; i++) {
      memory.events.push({ id: id++, library_id: lib.id, title: i % 2 === 0 ? "Zeka Oyunları Atölyesi" : "Masal ve Okuma Saati", description: "Kontenjan sınırlıdır. Katılım ücretsizdir.", category: i % 2 === 0 ? "Zeka Oyunu" : "Okuma", event_date: futureDate(i), event_time: "15:00", place: lib.name, min_age: 6, max_age: 14, capacity: 25, is_archived: false, created_at: new Date().toISOString() });
    }
  }
  const gameNames = ["Satranç", "Mangala", "Hedef 5", "Cezalı Tower", "Amiral Battı", "Dokun ve Tahmin Et", "Kahoot", "Ben Neyim?", "İsim Şehir", "Vampir Köylü"];
  memory.games = gameNames.map((g, idx) => ({ id: idx + 1, library_id: idx < 6 ? 1 : 2, name: g, category: "Zeka Oyunu", description: `${g} oyunu için açıklama ve kurallar.`, age_range: "7+", players: "2-6", pieces: "Tam", shelf_code: `ZO-${String(idx+1).padStart(3,"0")}`, available: true }));
}

async function initDb() {
  if (!usingPostgres) { await initMemory(); console.log("Memory demo modu aktif. Production için DATABASE_URL kullan."); return; }
  await query(`
    CREATE TABLE IF NOT EXISTS libraries (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '', address TEXT DEFAULT '', about TEXT DEFAULT '', working_hours TEXT DEFAULT '',
      score INTEGER DEFAULT 0, rank_name TEXT DEFAULT 'Başlangıç', status TEXT DEFAULT 'pending',
      logo_url TEXT DEFAULT '', banner_url TEXT DEFAULT '', logo_pos_x INTEGER DEFAULT 50, logo_pos_y INTEGER DEFAULT 50,
      logo_zoom NUMERIC DEFAULT 1.15, banner_pos_x INTEGER DEFAULT 50, banner_pos_y INTEGER DEFAULT 50, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
      library_id BIGINT REFERENCES libraries(id) ON DELETE CASCADE, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY, library_id BIGINT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT '', event_date DATE NOT NULL,
      event_time TEXT DEFAULT '', place TEXT DEFAULT '', min_age INTEGER DEFAULT 0, max_age INTEGER DEFAULT 99,
      capacity INTEGER DEFAULT 0, poster_url TEXT DEFAULT '', is_archived BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_library_date ON events(library_id, event_date DESC);
    CREATE INDEX IF NOT EXISTS idx_events_library_category ON events(library_id, category);
    CREATE INDEX IF NOT EXISTS idx_libraries_status_slug ON libraries(status, slug);
    CREATE TABLE IF NOT EXISTS applications (
      id BIGSERIAL PRIMARY KEY, library_id BIGINT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      phone TEXT NOT NULL, age INTEGER NOT NULL, status TEXT DEFAULT 'normal', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_app_event ON applications(event_id);
    CREATE TABLE IF NOT EXISTS games (
      id BIGSERIAL PRIMARY KEY, library_id BIGINT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, category TEXT DEFAULT '', description TEXT DEFAULT '', age_range TEXT DEFAULT '',
      players TEXT DEFAULT '', pieces TEXT DEFAULT '', shelf_code TEXT DEFAULT '', available BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_games_library ON games(library_id);
    CREATE TABLE IF NOT EXISTS announcements (
      id BIGSERIAL PRIMARY KEY, library_id BIGINT REFERENCES libraries(id) ON DELETE CASCADE, type TEXT DEFAULT 'library',
      title TEXT NOT NULL, body TEXT DEFAULT '', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS surveys (
      id BIGSERIAL PRIMARY KEY, library_id BIGINT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER, q5 INTEGER, note TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const libs = await query("SELECT COUNT(*)::int AS c FROM libraries");
  if (libs[0].c === 0) {
    const adminPass = await hash("123456");
    const libPass = await hash("123456");
    await query(`INSERT INTO libraries(name,slug,email,phone,address,about,working_hours,score,rank_name,status) VALUES 
      ($1,'yesilyurt','yesilyurt@ktb.gov.tr','0416 000 00 00','Yeşilyurt Mah. 2131 Sok. No:5 Merkez / ADIYAMAN',$2,'08:00 - 19:00',92,'Lider','approved'),
      ($3,'serik','serik@ktb.gov.tr','0242 000 00 00','Serik / ANTALYA',$4,'09:00 - 18:00',76,'Üreten','approved')`,
      ["Adıyaman Yeşilyurt Halk Kütüphanesi", "Çocuk, genç ve yetişkin kullanıcılar için etkinlik, okuma, çalışma ve zeka oyunları hizmetleri sunan halk kütüphanesi.", "Serik Halk Kütüphanesi", "Etkinlik ve zeka oyunları odaklı demo kütüphane."]);
    await query(`INSERT INTO users(email,password_hash,role,library_id,active) VALUES
      ('admin@ktb.gov.tr',$1,'SUPER_ADMIN',NULL,true),
      ('yesilyurt@ktb.gov.tr',$2,'LIBRARY_ADMIN',(SELECT id FROM libraries WHERE slug='yesilyurt'),true),
      ('serik@ktb.gov.tr',$2,'LIBRARY_ADMIN',(SELECT id FROM libraries WHERE slug='serik'),true)`, [adminPass, libPass]);
    const libRows = await query("SELECT id FROM libraries ORDER BY id");
    for (let lib of libRows) for (let i = 1; i <= 30; i++) await query(`INSERT INTO events(library_id,title,description,category,event_date,event_time,place,min_age,max_age,capacity)
      VALUES($1,$2,$3,$4,$5,'15:00','Kütüphane Çok Amaçlı Salon',6,14,25)`, [lib.id, i % 2 === 0 ? "Zeka Oyunları Atölyesi" : "Masal ve Okuma Saati", "Kontenjan sınırlıdır. Katılım ücretsizdir.", i % 2 === 0 ? "Zeka Oyunu" : "Okuma", futureDate(i)]);
    await query(`INSERT INTO announcements(library_id,type,title,body,active) VALUES
      ((SELECT id FROM libraries WHERE slug='yesilyurt'),'library','Etkinlik başvuruları açıldı','Çocuk etkinlikleri için başvurular başlamıştır.',true),
      (NULL,'global','Platform yayında','Dijital Kütüphane Platformu yayındadır.',true)`);
  }
  console.log("PostgreSQL veritabanı hazır.");
}

async function getLibraries({ q = "", limit = 20, offset = 0 } = {}) {
  if (usingPostgres) return query(`SELECT * FROM libraries WHERE status='approved' AND ($1='' OR name ILIKE '%'||$1||'%' OR slug ILIKE '%'||$1||'%') ORDER BY score DESC, name ASC LIMIT $2 OFFSET $3`, [q, limit, offset]);
  return memory.libraries.filter(l => l.status === "approved" && (!q || l.name.toLowerCase().includes(q.toLowerCase()) || l.slug.includes(q))).slice(offset, offset + limit);
}
async function getLibraryBySlug(slug) {
  if (usingPostgres) return (await query("SELECT * FROM libraries WHERE slug=$1 AND status='approved' LIMIT 1", [slug]))[0];
  return memory.libraries.find(l => l.slug === slug && l.status === "approved");
}
async function getLibraryById(id) {
  if (usingPostgres) return (await query("SELECT * FROM libraries WHERE id=$1 LIMIT 1", [id]))[0];
  return memory.libraries.find(l => Number(l.id) === Number(id));
}
async function getUserByEmail(email) {
  if (usingPostgres) return (await query("SELECT * FROM users WHERE email=$1 LIMIT 1", [email]))[0];
  return memory.users.find(u => u.email === email);
}
async function getEvents(libraryId, { page = 1, q = "", category = "", archived = false, limit = 12 } = {}) {
  const offset = (page - 1) * limit;
  if (usingPostgres) return query(`SELECT e.*, COALESCE(a.c,0)::int AS application_count
    FROM events e LEFT JOIN (SELECT event_id, COUNT(*) c FROM applications GROUP BY event_id) a ON a.event_id=e.id
    WHERE e.library_id=$1 AND e.is_archived=$2 AND ($3='' OR e.title ILIKE '%'||$3||'%' OR e.description ILIKE '%'||$3||'%') AND ($4='' OR e.category=$4)
    ORDER BY e.event_date ASC LIMIT $5 OFFSET $6`, [libraryId, archived, q, category, limit, offset]);
  return memory.events.filter(e => Number(e.library_id) === Number(libraryId) && e.is_archived === archived && (!q || e.title.toLowerCase().includes(q.toLowerCase())) && (!category || e.category === category)).slice(offset, offset + limit).map(e => ({ ...e, application_count: memory.applications.filter(a => a.event_id === e.id).length }));
}
async function getGames(libraryId) {
  if (usingPostgres) return query("SELECT * FROM games WHERE library_id=$1 ORDER BY name ASC LIMIT 100", [libraryId]);
  return memory.games.filter(g => Number(g.library_id) === Number(libraryId));
}
async function getAnnouncements(libraryId) {
  if (usingPostgres) return query("SELECT * FROM announcements WHERE active=true AND (library_id=$1 OR library_id IS NULL) ORDER BY created_at DESC LIMIT 5", [libraryId]);
  return memory.announcements.filter(a => a.active && (a.library_id === libraryId || a.library_id === null)).slice(0, 5);
}
function requireAdmin(req,res,next){ if(!req.session.user || req.session.user.role!=="SUPER_ADMIN") return res.redirect("/admin-login"); next(); }
function requireLibrary(req,res,next){ if(!req.session.user || req.session.user.role!=="LIBRARY_ADMIN") return res.redirect("/library-login"); next(); }

app.use((req,res,next)=>{ res.locals.user=req.session.user||null; res.locals.usingPostgres=usingPostgres; next(); });

app.get("/", async (req,res)=>{ const q=req.query.q||""; const libraries=await getLibraries({q,limit:12}); const stats={ libraries: usingPostgres?(await query("SELECT COUNT(*)::int c FROM libraries WHERE status='approved'"))[0].c:memory.libraries.length, events: usingPostgres?(await query("SELECT COUNT(*)::int c FROM events"))[0].c:memory.events.length, games: usingPostgres?(await query("SELECT COUNT(*)::int c FROM games"))[0].c:memory.games.length}; res.render("home",{libraries,q,stats}); });
app.get("/library-login",(req,res)=>res.render("login",{type:"library",error:""}));
app.get("/admin-login",(req,res)=>res.render("login",{type:"admin",error:""}));
app.post("/login",async(req,res)=>{ const {email,password,type}=req.body; const user=await getUserByEmail(email); if(!user||!user.active||!(await compare(password,user.password_hash))) return res.status(401).render("login",{type,error:"E-posta veya şifre hatalı."}); if(type==="admin"&&user.role!=="SUPER_ADMIN") return res.status(403).render("login",{type,error:"Bu sayfa sadece süper admin içindir."}); if(type==="library"&&user.role!=="LIBRARY_ADMIN") return res.status(403).render("login",{type,error:"Bu sayfa sadece kütüphane paneli içindir."}); req.session.user={id:user.id,email:user.email,role:user.role,library_id:user.library_id}; res.redirect(user.role==="SUPER_ADMIN"?"/admin":"/panel"); });
app.post("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/")));
app.get("/admin",requireAdmin,async(req,res)=>{ const libraries=await getLibraries({limit:100}); const stats={libraries:usingPostgres?(await query("SELECT COUNT(*)::int c FROM libraries"))[0].c:memory.libraries.length,events:usingPostgres?(await query("SELECT COUNT(*)::int c FROM events"))[0].c:memory.events.length,applications:usingPostgres?(await query("SELECT COUNT(*)::int c FROM applications"))[0].c:memory.applications.length}; res.render("admin",{libraries,stats}); });
app.get("/panel",requireLibrary,async(req,res)=>{ const lib=await getLibraryById(req.session.user.library_id); const events=await getEvents(lib.id,{limit:8}); const games=await getGames(lib.id); res.render("panel",{lib,events,games}); });
app.post("/panel/settings",requireLibrary,async(req,res)=>{ const libId=req.session.user.library_id; const fields={about:req.body.about||"",working_hours:req.body.working_hours||"",phone:req.body.phone||"",address:req.body.address||"",logo_pos_x:Number(req.body.logo_pos_x||50),logo_pos_y:Number(req.body.logo_pos_y||50),logo_zoom:Number(req.body.logo_zoom||1.15),banner_pos_x:Number(req.body.banner_pos_x||50),banner_pos_y:Number(req.body.banner_pos_y||50)}; if(usingPostgres) await query(`UPDATE libraries SET about=$1, working_hours=$2, phone=$3, address=$4, logo_pos_x=$5, logo_pos_y=$6, logo_zoom=$7, banner_pos_x=$8, banner_pos_y=$9 WHERE id=$10`,[fields.about,fields.working_hours,fields.phone,fields.address,fields.logo_pos_x,fields.logo_pos_y,fields.logo_zoom,fields.banner_pos_x,fields.banner_pos_y,libId]); else Object.assign(memory.libraries.find(l=>l.id===libId),fields); res.redirect("/panel"); });
app.post("/panel/events",requireLibrary,async(req,res)=>{ const libId=req.session.user.library_id; const e=req.body; if(usingPostgres) await query(`INSERT INTO events(library_id,title,description,category,event_date,event_time,place,min_age,max_age,capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[libId,e.title,e.description||"",e.category||"",e.event_date,e.event_time||"",e.place||"",Number(e.min_age||0),Number(e.max_age||99),Number(e.capacity||0)]); else memory.events.push({id:memory.events.length+1,library_id:libId,title:e.title,description:e.description||"",category:e.category||"",event_date:e.event_date,event_time:e.event_time||"",place:e.place||"",min_age:Number(e.min_age||0),max_age:Number(e.max_age||99),capacity:Number(e.capacity||0),is_archived:false,created_at:new Date().toISOString()}); res.redirect("/panel"); });
app.get("/:slug",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); const announcements=await getAnnouncements(lib.id); const events=await getEvents(lib.id,{limit:4}); const games=await getGames(lib.id); res.render("library",{lib,announcements,events,games}); });
app.get("/:slug/events",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); const page=Math.max(1,Number(req.query.page||1)); const q=req.query.q||""; const category=req.query.category||""; const events=await getEvents(lib.id,{page,q,category,limit:12}); res.render("events",{lib,events,page,q,category}); });
app.post("/:slug/events/:id/apply",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); const eventId=Number(req.params.id), phone=req.body.phone||"", age=Number(req.body.age||0); if(!/^05\d{9}$/.test(phone)) return res.status(400).send("Telefon 05 ile başlamalı ve 11 hane olmalı."); let ev; if(usingPostgres){ ev=(await query("SELECT * FROM events WHERE id=$1 AND library_id=$2",[eventId,lib.id]))[0]; if(!ev)return next(); if(age<ev.min_age||age>ev.max_age)return res.status(400).send("Yaş aralığı uygun değil."); const count=(await query("SELECT COUNT(*)::int c FROM applications WHERE event_id=$1",[eventId]))[0].c; const status=count>=ev.capacity?"reserve":"normal"; await query(`INSERT INTO applications(library_id,event_id,first_name,last_name,phone,age,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,[lib.id,eventId,req.body.first_name,req.body.last_name,phone,age,status]); } else { ev=memory.events.find(e=>e.id===eventId&&e.library_id===lib.id); if(!ev)return next(); if(age<ev.min_age||age>ev.max_age)return res.status(400).send("Yaş aralığı uygun değil."); const count=memory.applications.filter(a=>a.event_id===eventId).length; const status=count>=ev.capacity?"reserve":"normal"; memory.applications.push({id:memory.applications.length+1,library_id:lib.id,event_id:eventId,first_name:req.body.first_name,last_name:req.body.last_name,phone,age,status,created_at:new Date().toISOString()}); } res.redirect(`/${lib.slug}/events?success=1`); });
app.get("/:slug/games",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); res.render("games",{lib,games:await getGames(lib.id)}); });
app.get("/:slug/archive",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); res.render("archive",{lib,events:await getEvents(lib.id,{archived:true,limit:24})}); });
app.get("/:slug/survey",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); res.render("survey",{lib}); });
app.post("/:slug/survey",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); const vals=[1,2,3,4,5].map(n=>Number(req.body[`q${n}`]||5)); if(usingPostgres) await query("INSERT INTO surveys(library_id,q1,q2,q3,q4,q5,note) VALUES($1,$2,$3,$4,$5,$6,$7)",[lib.id,...vals,req.body.note||""]); else memory.surveys.push({id:memory.surveys.length+1,library_id:lib.id,q1:vals[0],q2:vals[1],q3:vals[2],q4:vals[3],q5:vals[4],note:req.body.note||""}); res.redirect(`/${lib.slug}/survey?thanks=1`); });
app.get("/:slug/contact",async(req,res,next)=>{ const lib=await getLibraryBySlug(req.params.slug); if(!lib)return next(); res.render("contact",{lib}); });
app.use((req,res)=>res.status(404).render("404"));
initDb().then(()=>app.listen(PORT,()=>console.log(`Server çalışıyor: ${PORT}`))).catch(err=>{console.error("Başlatma hatası:",err);process.exit(1);});

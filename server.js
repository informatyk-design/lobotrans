const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app     = express();
const DB_FILE = path.join(__dirname, 'data.json');
const USE_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// ── Data helpers (dual: file locally / Vercel KV in production) ─────────

const EMPTY_DB = () => ({
  vehicles: [], routes: [], drivers: [], vehicle_statuses: [],
  nextVehicleId: 1, nextRouteId: 1, nextDriverId: 1, nextStatusId: 1,
});

async function readDB() {
  if (USE_KV) {
    const { kv } = require('@vercel/kv');
    const db = await kv.get('lobotrans_db');
    return db || EMPTY_DB();
  }
  if (!fs.existsSync(DB_FILE)) return EMPTY_DB();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return EMPTY_DB(); }
}

async function writeDB(db) {
  if (USE_KV) {
    const { kv } = require('@vercel/kv');
    await kv.set('lobotrans_db', db);
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
}

// ── Seed sample data if empty ──────────────────────────────────────────

async function seed() {
  const db = await readDB();
  if (db.vehicles.length === 0) {
    db.vehicles = [
      { id: 1, name: 'WL6952K',  color: '#e74c3c', sort_order: 1 },
      { id: 2, name: 'WZ494KW',  color: '#3498db', sort_order: 2 },
      { id: 3, name: 'WZ493KW',  color: '#808000', sort_order: 3 },
      { id: 4, name: 'WZW27207', color: '#e91e8c', sort_order: 4 },
      { id: 5, name: 'WZ100AB',  color: '#2ecc71', sort_order: 5 },
    ];
    db.nextVehicleId = 6;
    await writeDB(db);
  }
}

// ── Middleware ─────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Vehicles ───────────────────────────────────────────────────────────

app.get('/api/vehicles', async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.vehicles.sort((a, b) => a.sort_order - b.sort_order));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !color) return res.status(400).json({ error: 'name and color required' });
    const db       = await readDB();
    const maxOrder = db.vehicles.reduce((m, v) => Math.max(m, v.sort_order || 0), 0);
    const vehicle  = { id: db.nextVehicleId++, name: name.trim(), color, sort_order: maxOrder + 1 };
    db.vehicles.push(vehicle);
    await writeDB(db);
    res.json(vehicle);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehicles/:id', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !color) return res.status(400).json({ error: 'name and color required' });
    const db = await readDB();
    const v  = db.vehicles.find(x => x.id === parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'not found' });
    v.name  = name.trim();
    v.color = color;
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = await readDB();
    db.vehicles = db.vehicles.filter(v => v.id !== id);
    db.routes   = db.routes.filter(r => r.vehicle_id !== id);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Routes ─────────────────────────────────────────────────────────────

app.get('/api/routes', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const db = await readDB();

    const vehicleMap = {};
    db.vehicles.forEach(v => { vehicleMap[v.id] = v; });

    const rows = db.routes
      .filter(r => r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
      .map(r => ({
        ...r,
        vehicle_name:  vehicleMap[r.vehicle_id]?.name  || '',
        vehicle_color: vehicleMap[r.vehicle_id]?.color || '#888',
      }));

    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Returns conflicting route or null
function findOverlap(db, vehicle_id, date, start_time, end_time, excludeId = null) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const newS  = toMin(start_time);
  const newE  = toMin(end_time);
  return db.routes.find(r =>
    r.vehicle_id === parseInt(vehicle_id) &&
    r.date       === date &&
    r.id         !== excludeId &&
    newS < toMin(r.end_time) &&
    newE > toMin(r.start_time)
  ) || null;
}

app.post('/api/routes', async (req, res) => {
  try {
    const { vehicle_id, date, start_time, end_time, from_location, to_location, driver, notes } = req.body;
    if (!vehicle_id || !date || !start_time || !end_time)
      return res.status(400).json({ error: 'vehicle_id, date, start_time, end_time required' });
    const db = await readDB();

    const conflict = findOverlap(db, vehicle_id, date, start_time, end_time);
    if (conflict)
      return res.status(409).json({
        error: 'overlap',
        message: `Pojazd ma już trasę w tym czasie (${conflict.start_time}–${conflict.end_time}).`,
        conflict: { start_time: conflict.start_time, end_time: conflict.end_time,
                    from_location: conflict.from_location, to_location: conflict.to_location },
      });

    if (!db.routes) db.routes = [];
    const route = {
      id: db.nextRouteId++, vehicle_id: parseInt(vehicle_id),
      date, start_time, end_time,
      from_location: from_location || '', to_location: to_location || '',
      driver: driver || '', notes: notes || '',
      created_at: new Date().toISOString(),
    };
    db.routes.push(route);
    await writeDB(db);
    res.json({ id: route.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/routes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = await readDB();
    const r  = db.routes.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'not found' });
    const { vehicle_id, date, start_time, end_time, from_location, to_location, driver, notes } = req.body;

    const conflict = findOverlap(db, vehicle_id, date, start_time, end_time, id);
    if (conflict)
      return res.status(409).json({
        error: 'overlap',
        message: `Pojazd ma już trasę w tym czasie (${conflict.start_time}–${conflict.end_time}).`,
        conflict: { start_time: conflict.start_time, end_time: conflict.end_time,
                    from_location: conflict.from_location, to_location: conflict.to_location },
      });

    r.vehicle_id    = parseInt(vehicle_id);
    r.date          = date;
    r.start_time    = start_time;
    r.end_time      = end_time;
    r.from_location = from_location || '';
    r.to_location   = to_location   || '';
    r.driver        = driver  || '';
    r.notes         = notes   || '';
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/routes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = await readDB();
    db.routes = db.routes.filter(r => r.id !== id);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Drivers ────────────────────────────────────────────────────────────

app.get('/api/drivers', async (req, res) => {
  try {
    const db   = await readDB();
    const list = (db.drivers || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/drivers', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const db = await readDB();
    if (!db.drivers)      db.drivers = [];
    if (!db.nextDriverId) db.nextDriverId = 1;
    const exists = db.drivers.find(d => d.name.toLowerCase() === name.trim().toLowerCase());
    if (exists) return res.status(409).json({ error: 'Kierowca o tym imieniu już istnieje.' });
    const driver = { id: db.nextDriverId++, name: name.trim(), created_at: new Date().toISOString() };
    db.drivers.push(driver);
    await writeDB(db);
    res.json(driver);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/drivers/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = await readDB();
    db.drivers = (db.drivers || []).filter(d => d.id !== id);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Statuses ───────────────────────────────────────────────────────────

app.get('/api/statuses', async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.vehicle_statuses || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/statuses', async (req, res) => {
  try {
    const { vehicle_id, status, note } = req.body;
    if (!vehicle_id || !status) return res.status(400).json({ error: 'vehicle_id and status required' });
    const db = await readDB();
    if (!db.vehicle_statuses) db.vehicle_statuses = [];
    if (!db.nextStatusId)     db.nextStatusId = 1;
    db.vehicle_statuses = db.vehicle_statuses.filter(s => s.vehicle_id !== parseInt(vehicle_id));
    const entry = {
      id: db.nextStatusId++,
      vehicle_id: parseInt(vehicle_id),
      status,
      note: note || '',
      set_at: new Date().toISOString(),
    };
    db.vehicle_statuses.push(entry);
    await writeDB(db);
    res.json(entry);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/statuses/:vehicleId', async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    const db = await readDB();
    db.vehicle_statuses = (db.vehicle_statuses || []).filter(s => s.vehicle_id !== vehicleId);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ──────────────────────────────────────────────────────────────

seed().then(() => {
  if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`\n🚛  Lobotrans uruchomiony na http://localhost:${PORT}\n`);
    });
  }
}).catch(console.error);

module.exports = app;

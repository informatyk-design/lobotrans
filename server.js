const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app     = express();
const DB_FILE = path.join(__dirname, 'data.json');

// ── Data helpers ───────────────────────────────────────────────────────

function readDB() {
  if (!fs.existsSync(DB_FILE)) return { vehicles: [], routes: [], nextVehicleId: 1, nextRouteId: 1 };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { vehicles: [], routes: [], nextVehicleId: 1, nextRouteId: 1 }; }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ── Seed sample data if empty ──────────────────────────────────────────

(function seed() {
  const db = readDB();
  if (db.vehicles.length === 0) {
    db.vehicles = [
      { id: 1, name: 'WL6952K',  color: '#e74c3c', sort_order: 1 },
      { id: 2, name: 'WZ494KW',  color: '#3498db', sort_order: 2 },
      { id: 3, name: 'WZ493KW',  color: '#808000', sort_order: 3 },
      { id: 4, name: 'WZW27207', color: '#e91e8c', sort_order: 4 },
      { id: 5, name: 'WZ100AB',  color: '#2ecc71', sort_order: 5 },
    ];
    db.nextVehicleId = 6;
    writeDB(db);
  }
})();

// ── Middleware ─────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Vehicles ───────────────────────────────────────────────────────────

app.get('/api/vehicles', (req, res) => {
  const db = readDB();
  res.json(db.vehicles.sort((a, b) => a.sort_order - b.sort_order));
});

app.post('/api/vehicles', (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'name and color required' });
  const db      = readDB();
  const maxOrder = db.vehicles.reduce((m, v) => Math.max(m, v.sort_order || 0), 0);
  const vehicle  = { id: db.nextVehicleId++, name: name.trim(), color, sort_order: maxOrder + 1 };
  db.vehicles.push(vehicle);
  writeDB(db);
  res.json(vehicle);
});

app.put('/api/vehicles/:id', (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'name and color required' });
  const db = readDB();
  const v  = db.vehicles.find(x => x.id === parseInt(req.params.id));
  if (!v) return res.status(404).json({ error: 'not found' });
  v.name  = name.trim();
  v.color = color;
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  db.vehicles = db.vehicles.filter(v => v.id !== id);
  db.routes   = db.routes.filter(r => r.vehicle_id !== id);
  writeDB(db);
  res.json({ success: true });
});

// ── Routes ─────────────────────────────────────────────────────────────

app.get('/api/routes', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const db = readDB();

  // Join with vehicle data
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

app.post('/api/routes', (req, res) => {
  const { vehicle_id, date, start_time, end_time, from_location, to_location, driver, notes } = req.body;
  if (!vehicle_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'vehicle_id, date, start_time, end_time required' });
  const db = readDB();

  const conflict = findOverlap(db, vehicle_id, date, start_time, end_time);
  if (conflict)
    return res.status(409).json({
      error: 'overlap',
      message: `Pojazd ma już trasę w tym czasie (${conflict.start_time}–${conflict.end_time}).`,
      conflict: { start_time: conflict.start_time, end_time: conflict.end_time,
                  from_location: conflict.from_location, to_location: conflict.to_location },
    });

  const route = {
    id: db.nextRouteId++, vehicle_id: parseInt(vehicle_id),
    date, start_time, end_time,
    from_location: from_location || '', to_location: to_location || '',
    driver: driver || '', notes: notes || '',
    created_at: new Date().toISOString(),
  };
  db.routes.push(route);
  writeDB(db);
  res.json({ id: route.id });
});

app.put('/api/routes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
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
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/routes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  db.routes = db.routes.filter(r => r.id !== id);
  writeDB(db);
  res.json({ success: true });
});

// ── Drivers ────────────────────────────────────────────────────────────

app.get('/api/drivers', (req, res) => {
  const db = readDB();
  const list = (db.drivers || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  res.json(list);
});

app.post('/api/drivers', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  if (!db.drivers)     db.drivers = [];
  if (!db.nextDriverId) db.nextDriverId = 1;
  const exists = db.drivers.find(d => d.name.toLowerCase() === name.trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'Kierowca o tym imieniu już istnieje.' });
  const driver = { id: db.nextDriverId++, name: name.trim(), created_at: new Date().toISOString() };
  db.drivers.push(driver);
  writeDB(db);
  res.json(driver);
});

app.delete('/api/drivers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  db.drivers = (db.drivers || []).filter(d => d.id !== id);
  writeDB(db);
  res.json({ success: true });
});

// ── Statuses ───────────────────────────────────────────────────────────

app.get('/api/statuses', (req, res) => {
  const db = readDB();
  res.json(db.vehicle_statuses || []);
});

app.post('/api/statuses', (req, res) => {
  const { vehicle_id, status, note } = req.body;
  if (!vehicle_id || !status) return res.status(400).json({ error: 'vehicle_id and status required' });
  const db = readDB();
  if (!db.vehicle_statuses) db.vehicle_statuses = [];
  if (!db.nextStatusId)     db.nextStatusId = 1;
  // Replace existing status for this vehicle
  db.vehicle_statuses = db.vehicle_statuses.filter(s => s.vehicle_id !== parseInt(vehicle_id));
  const entry = {
    id: db.nextStatusId++,
    vehicle_id: parseInt(vehicle_id),
    status,
    note: note || '',
    set_at: new Date().toISOString(),
  };
  db.vehicle_statuses.push(entry);
  writeDB(db);
  res.json(entry);
});

app.delete('/api/statuses/:vehicleId', (req, res) => {
  const vehicleId = parseInt(req.params.vehicleId);
  const db = readDB();
  db.vehicle_statuses = (db.vehicle_statuses || []).filter(s => s.vehicle_id !== vehicleId);
  writeDB(db);
  res.json({ success: true });
});

// ── Start ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚛  Lobotrans uruchomiony na http://localhost:${PORT}\n`);
});

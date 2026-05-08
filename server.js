const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8766);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, "public", "index.html")) ? path.join(ROOT, "public") : ROOT;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(ROOT, "backups");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PRODUCT_PATH = process.env.PRODUCT_PATH ? path.resolve(process.env.PRODUCT_PATH) : path.join(DATA_DIR, "products.json");
const SEED_PRODUCT_PATH = fs.existsSync(path.join(ROOT, "data", "products.json"))
  ? path.join(ROOT, "data", "products.json")
  : path.join(ROOT, "products.json");
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 6 * 1024 * 1024);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const BACKUP_RETENTION = Number(process.env.BACKUP_RETENTION || 100);

const sessions = new Map();
const loginAttempts = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts[0] === "pbkdf2" && parts.length === 3) {
    const [, salt, expected] = parts;
    const actual = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  }
  const [salt, expected] = parts;
  if (!salt || !expected) return false;
  const actual = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function nowIso() {
  return new Date().toISOString();
}

function businessDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function businessStamp() {
  return businessDate().replace(/-/g, "");
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fsp.rename(temp, file);
}

async function backupDb(db) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fsp.writeFile(path.join(BACKUP_DIR, `db-${stamp}.json`), JSON.stringify(db, null, 2));
  await pruneBackups("db-");
}

async function backupProducts(products) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fsp.writeFile(path.join(BACKUP_DIR, `products-${stamp}.json`), JSON.stringify(products, null, 2));
  await pruneBackups("products-");
}

async function pruneBackups(prefix) {
  if (!BACKUP_RETENTION || BACKUP_RETENTION < 1) return;
  const entries = await fsp.readdir(BACKUP_DIR).catch(() => []);
  const matching = entries.filter((name) => name.startsWith(prefix) && name.endsWith(".json")).sort();
  const excess = matching.slice(0, Math.max(0, matching.length - BACKUP_RETENTION));
  await Promise.all(excess.map((name) => fsp.unlink(path.join(BACKUP_DIR, name)).catch(() => {})));
}

async function seedDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(PRODUCT_PATH);
  } catch {
    if (SEED_PRODUCT_PATH !== PRODUCT_PATH) {
      await fsp.copyFile(SEED_PRODUCT_PATH, PRODUCT_PATH);
    }
  }
  const products = await readJson(PRODUCT_PATH, []);
  const existing = await readJson(DB_PATH, null);
  if (existing) return existing;
  const db = {
    meta: { createdAt: nowIso(), lastBackupAt: null },
    outlets: [
      { id: "outlet_vijay_chowk", name: "Vijay Chowk", active: true },
      { id: "outlet_main", name: "Main Outlet", active: true }
    ],
    users: [
      { id: "u_admin", name: "Owner Admin", username: "admin", role: "admin", passwordHash: hashPassword("admin123"), outletId: null },
      { id: "u_factory", name: "Factory Dispatch", username: "factory", role: "factory", passwordHash: hashPassword("factory123"), outletId: null },
      { id: "u_vijay", name: "Vijay Outlet", username: "vijay", role: "outlet", passwordHash: hashPassword("outlet123"), outletId: "outlet_vijay_chowk" },
      { id: "u_main", name: "Main Outlet", username: "mainoutlet", role: "outlet", passwordHash: hashPassword("outlet123"), outletId: "outlet_main" }
    ],
    demands: [],
    dispatches: [],
    returns: [],
    audit: [
      { id: id("audit"), at: nowIso(), actor: "system", action: "seed", entity: "database", note: `Seeded ${products.length} products` }
    ]
  };
  await writeJson(DB_PATH, db);
  await backupDb(db);
  return db;
}

function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function sanitizeProducts(products, role) {
  if (role === "admin") return products;
  return products.map(({ price, ...p }) => p);
}

function canSeeOutlet(user, outletId) {
  return user.role !== "outlet" || user.outletId === outletId;
}

function pickDemandItemsForDispatch(demand, dispatchItems) {
  const byProduct = new Map((demand?.items || []).map((item) => [item.productId, Number(item.qty || 0)]));
  return dispatchItems.map((item) => {
    const requested = byProduct.get(item.productId);
    return { ...item, requestedQty: requested ?? null };
  });
}

function computeDispatch(dispatch) {
  let sentQty = 0;
  let receivedQty = 0;
  let shortageQty = 0;
  let extraQty = 0;
  let returnedQty = 0;
  for (const item of dispatch.items || []) {
    const sent = Number(item.qty || 0);
    const received = item.receivedQty == null ? null : Number(item.receivedQty || 0);
    const damaged = Number(item.damagedQty || 0);
    const excess = Number(item.excessReturnQty || 0);
    sentQty += sent;
    if (received != null) {
      receivedQty += received;
      shortageQty += Math.max(0, sent - received);
      extraQty += Math.max(0, received - sent);
      returnedQty += damaged + excess;
    }
  }
  return {
    sentQty,
    receivedQty,
    shortageQty,
    extraQty,
    returnedQty,
    soldQty: Math.max(0, receivedQty - returnedQty)
  };
}

async function getBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function securityHeaders(type) {
  const headers = {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
  if (process.env.NODE_ENV === "production") headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, securityHeaders(type));
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function sendWithHeaders(res, status, body, headers, type = "application/json; charset=utf-8") {
  res.writeHead(status, { ...securityHeaders(type), ...headers });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function fail(res, status, message) {
  send(res, status, { error: message });
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return null;
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(Boolean));
}

function sessionCookie(token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `mithai_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `mithai_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return parseCookies(req).mithai_session || null;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function loginLimited(req, username) {
  const key = `${clientIp(req)}:${String(username || "").toLowerCase()}`;
  const now = Date.now();
  const current = loginAttempts.get(key) || [];
  const recent = current.filter((t) => now - t < LOGIN_WINDOW_MS);
  loginAttempts.set(key, recent);
  return recent.length >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(req, username) {
  const key = `${clientIp(req)}:${String(username || "").toLowerCase()}`;
  const recent = (loginAttempts.get(key) || []).filter((t) => Date.now() - t < LOGIN_WINDOW_MS);
  recent.push(Date.now());
  loginAttempts.set(key, recent);
}

function clearFailedLogins(req, username) {
  loginAttempts.delete(`${clientIp(req)}:${String(username || "").toLowerCase()}`);
}

async function requireUser(req, res, db) {
  const token = getToken(req);
  const session = token && sessions.get(token);
  if (!session || Date.now() - session.at > SESSION_TTL_MS) {
    if (token) sessions.delete(token);
    fail(res, 401, "Login required");
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) {
    fail(res, 401, "Session user not found");
    return null;
  }
  session.at = Date.now();
  return user;
}

function audit(db, user, action, entity, entityId, note = "") {
  db.audit.unshift({ id: id("audit"), at: nowIso(), actor: user.username, role: user.role, action, entity, entityId, note });
  db.audit = db.audit.slice(0, 2000);
}

async function mutate(db, user, action, entity, entityId, note) {
  audit(db, user, action, entity, entityId, note);
  db.meta.lastBackupAt = nowIso();
  await writeJson(DB_PATH, db);
  await backupDb(db);
}

function validateItems(products, items) {
  if (!Array.isArray(items) || items.length === 0) return "Add at least one product";
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) return "Product must be selected from master SKU list";
    if (!(Number(item.qty) > 0)) return "Quantity must be greater than zero";
    if (product.unit === "pcs" && !Number.isInteger(Number(item.qty))) return `${product.name} must be entered in whole pieces`;
    if (item.currentStock != null && item.currentStock !== "" && product.unit === "pcs" && !Number.isInteger(Number(item.currentStock))) return `${product.name} current stock must be whole pieces`;
  }
  return null;
}

function cleanProductInput(body) {
  const department = String(body.department || "").trim().replace(/\s+/g, " ").toLowerCase();
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  const unit = body.unit === "pcs" ? "pcs" : "kg";
  const price = Number(body.price || 0);
  if (!department) return { error: "Department is required" };
  if (!name) return { error: "Product name is required" };
  if (price < 0) return { error: "Price cannot be negative" };
  return { product: { department, name, unit, price } };
}

function cleanOutletInput(body) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Outlet name is required" };
  return {
    outlet: {
      name,
      active: body.active === false || body.active === "false" ? false : true
    }
  };
}

function cleanUserInput(body, existing = {}) {
  const name = String(body.name ?? existing.name ?? "").trim().replace(/\s+/g, " ");
  const username = String(body.username ?? existing.username ?? "").trim().toLowerCase();
  const role = ["admin", "factory", "outlet"].includes(body.role ?? existing.role) ? (body.role ?? existing.role) : "outlet";
  const outletId = role === "outlet" ? String(body.outletId ?? existing.outletId ?? "") : null;
  if (!name) return { error: "User name is required" };
  if (!username) return { error: "Username is required" };
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return { error: "Username must be 3-32 letters/numbers" };
  return { user: { name, username, role, outletId } };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function isLocked(record) {
  return Date.now() - new Date(record.createdAt).getTime() > 24 * 60 * 60 * 1000;
}

async function enforceProductionPasswords(db) {
  if (process.env.NODE_ENV !== "production") return;
  const defaults = [
    ["admin", "admin123"],
    ["factory", "factory123"],
    ["vijay", "outlet123"],
    ["mainoutlet", "outlet123"]
  ];
  const rotated = [];
  for (const [username, password] of defaults) {
    const user = db.users.find((u) => u.username === username);
    if (user && verifyPassword(password, user.passwordHash)) {
      const nextPassword = crypto.randomBytes(12).toString("base64url");
      user.passwordHash = hashPassword(nextPassword);
      rotated.push({ username, password: nextPassword });
    }
  }
  if (!rotated.length) return;
  db.audit.unshift({ id: id("audit"), at: nowIso(), actor: "system", role: "system", action: "rotate_defaults", entity: "users", note: "Production start rotated default passwords" });
  await writeJson(DB_PATH, db);
  await backupDb(db);
  const lines = [
    "Temporary production credentials generated on first secure start.",
    "Log in, then immediately change these passwords in Settings.",
    "",
    ...rotated.map((entry) => `${entry.username}: ${entry.password}`),
    ""
  ];
  await fsp.writeFile(path.join(DATA_DIR, "initial-credentials.txt"), lines.join("\n"), { mode: 0o600 });
}

function validatePhoto(photo) {
  if (!photo) return null;
  if (typeof photo !== "string") return "Photo upload is invalid";
  if (photo.length > MAX_BODY_BYTES) return "Photo upload is too large";
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(photo)) return "Photo must be PNG, JPG, or WEBP";
  return null;
}

async function handleApi(req, res, db, products) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === "POST /api/login") {
    const body = await getBody(req);
    const username = String(body.username || "").toLowerCase();
    if (loginLimited(req, username)) return fail(res, 429, "Too many login attempts. Try again later.");
    const user = db.users.find((u) => u.username.toLowerCase() === username);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      recordFailedLogin(req, username);
      return fail(res, 401, "Invalid username or password");
    }
    clearFailedLogins(req, username);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { userId: user.id, at: Date.now() });
    return sendWithHeaders(res, 200, { user: publicUser(user) }, { "set-cookie": sessionCookie(token) });
  }

  if (route === "GET /api/health") {
    return send(res, 200, { ok: true, at: nowIso() });
  }

  const user = await requireUser(req, res, db);
  if (!user) return;

  if (route === "POST /api/logout") {
    const token = getToken(req);
    if (token) sessions.delete(token);
    return sendWithHeaders(res, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
  }

  if (route === "GET /api/bootstrap") {
    const demands = db.demands.filter((d) => canSeeOutlet(user, d.outletId));
    const dispatches = db.dispatches.filter((d) => canSeeOutlet(user, d.outletId));
    return send(res, 200, {
      user: publicUser(user),
      outlets: user.role === "outlet" ? db.outlets.filter((o) => o.id === user.outletId) : db.outlets,
      users: user.role === "admin" ? db.users.map(publicUser) : [],
      products: sanitizeProducts(products, user.role),
      departments: [...new Set(products.map((p) => p.department))].sort(),
      demands,
      dispatches: dispatches.map((d) => ({ ...d, totals: computeDispatch(d) })),
      audit: user.role === "admin" ? db.audit.slice(0, 250) : []
    });
  }

  if (route === "POST /api/change-password") {
    const body = await getBody(req);
    const targetUser = user.role === "admin" && body.userId ? db.users.find((u) => u.id === body.userId) : user;
    if (!targetUser) return fail(res, 404, "User not found");
    const nextPassword = String(body.newPassword || "");
    if (nextPassword.length < 8) return fail(res, 400, "Password must be at least 8 characters");
    if (targetUser.id === user.id && !verifyPassword(String(body.currentPassword || ""), user.passwordHash)) return fail(res, 400, "Current password is incorrect");
    targetUser.passwordHash = hashPassword(nextPassword);
    for (const [token, session] of sessions) {
      if (session.userId === targetUser.id) sessions.delete(token);
    }
    await mutate(db, user, "change_password", "user", targetUser.id, targetUser.id === user.id ? "Changed own password" : `Admin reset ${targetUser.username}`);
    const headers = targetUser.id === user.id ? { "set-cookie": clearSessionCookie() } : {};
    return sendWithHeaders(res, 200, { ok: true }, headers);
  }

  if (route === "POST /api/outlets") {
    if (user.role !== "admin") return fail(res, 403, "Only admin can add outlets");
    const body = await getBody(req);
    const { outlet, error } = cleanOutletInput(body);
    if (error) return fail(res, 400, error);
    const duplicate = db.outlets.find((o) => o.name.toLowerCase() === outlet.name.toLowerCase());
    if (duplicate) return fail(res, 400, "Outlet already exists");
    outlet.id = `outlet_${slug(outlet.name)}_${crypto.randomBytes(3).toString("hex")}`;
    db.outlets.push(outlet);
    await mutate(db, user, "create", "outlet", outlet.id, `Added ${outlet.name}`);
    return send(res, 201, outlet);
  }

  const outletMatch = url.pathname.match(/^\/api\/outlets\/([^/]+)$/);
  if (req.method === "PATCH" && outletMatch) {
    if (user.role !== "admin") return fail(res, 403, "Only admin can edit outlets");
    const existing = db.outlets.find((o) => o.id === outletMatch[1]);
    if (!existing) return fail(res, 404, "Outlet not found");
    const { outlet, error } = cleanOutletInput({ ...existing, ...(await getBody(req)) });
    if (error) return fail(res, 400, error);
    Object.assign(existing, outlet);
    await mutate(db, user, "update", "outlet", existing.id, `Updated ${existing.name}`);
    return send(res, 200, existing);
  }

  if (route === "POST /api/users") {
    if (user.role !== "admin") return fail(res, 403, "Only admin can add users");
    const body = await getBody(req);
    const { user: nextUser, error } = cleanUserInput(body);
    if (error) return fail(res, 400, error);
    if (nextUser.outletId && !db.outlets.some((o) => o.id === nextUser.outletId)) return fail(res, 400, "Invalid outlet for user");
    if (db.users.some((u) => u.username === nextUser.username)) return fail(res, 400, "Username already exists");
    nextUser.id = `u_${slug(nextUser.username)}_${crypto.randomBytes(3).toString("hex")}`;
    nextUser.passwordHash = hashPassword(String(body.password || "changeme123"));
    db.users.push(nextUser);
    await mutate(db, user, "create", "user", nextUser.id, `Added ${nextUser.username}`);
    return send(res, 201, publicUser(nextUser));
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === "PATCH" && userMatch) {
    if (user.role !== "admin") return fail(res, 403, "Only admin can edit users");
    const existing = db.users.find((u) => u.id === userMatch[1]);
    if (!existing) return fail(res, 404, "User not found");
    const body = await getBody(req);
    const { user: nextUser, error } = cleanUserInput(body, existing);
    if (error) return fail(res, 400, error);
    if (nextUser.outletId && !db.outlets.some((o) => o.id === nextUser.outletId)) return fail(res, 400, "Invalid outlet for user");
    if (db.users.some((u) => u.id !== existing.id && u.username === nextUser.username)) return fail(res, 400, "Username already exists");
    Object.assign(existing, nextUser);
    if (body.password) existing.passwordHash = hashPassword(String(body.password));
    await mutate(db, user, "update", "user", existing.id, `Updated ${existing.username}`);
    return send(res, 200, publicUser(existing));
  }

  if (route === "POST /api/products") {
    if (user.role !== "admin") return fail(res, 403, "Only admin can add SKUs");
    const body = await getBody(req);
    const { product, error } = cleanProductInput(body);
    if (error) return fail(res, 400, error);
    const duplicate = products.find((p) => p.department === product.department && p.name.toLowerCase() === product.name.toLowerCase());
    if (duplicate) return fail(res, 400, "This SKU already exists in the same department");
    product.id = `p${String(products.length + 1).padStart(4, "0")}-${slug(`${product.department}-${product.name}`)}`;
    product.createdAt = nowIso();
    product.updatedAt = nowIso();
    products.push(product);
    products.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    await writeJson(PRODUCT_PATH, products);
    await backupProducts(products);
    await mutate(db, user, "create", "product", product.id, `Added ${product.name}`);
    return send(res, 201, product);
  }

  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === "PATCH" && productMatch) {
    if (user.role !== "admin") return fail(res, 403, "Only admin can edit SKUs");
    const existing = products.find((p) => p.id === productMatch[1]);
    if (!existing) return fail(res, 404, "SKU not found");
    const body = await getBody(req);
    const { product, error } = cleanProductInput({ ...existing, ...body });
    if (error) return fail(res, 400, error);
    const duplicate = products.find((p) => p.id !== existing.id && p.department === product.department && p.name.toLowerCase() === product.name.toLowerCase());
    if (duplicate) return fail(res, 400, "Another SKU already has this name in the same department");
    Object.assign(existing, product, { updatedAt: nowIso() });
    products.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    await writeJson(PRODUCT_PATH, products);
    await backupProducts(products);
    await mutate(db, user, "update", "product", existing.id, `Updated ${existing.name}`);
    return send(res, 200, existing);
  }

  if (route === "POST /api/demands") {
    if (!["admin", "outlet"].includes(user.role)) return fail(res, 403, "Only outlets or admin can raise challan demand");
    const body = await getBody(req);
    const outletId = user.role === "outlet" ? user.outletId : body.outletId;
    if (!db.outlets.some((o) => o.id === outletId)) return fail(res, 400, "Invalid outlet");
    const error = validateItems(products, body.items);
    if (error) return fail(res, 400, error);
    const photoError = validatePhoto(body.photo);
    if (photoError) return fail(res, 400, photoError);
    const demand = {
      id: id("demand"),
      challanNo: `REQ-${businessStamp()}-${db.demands.length + 1}`,
      outletId,
      status: "pending",
      note: String(body.note || ""),
      photo: body.photo || null,
      mode: body.mode === "bulk" ? "bulk" : "manual",
      createdAt: nowIso(),
      createdBy: user.username,
      items: body.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          qty: Number(item.qty),
          unit: product?.unit || "kg",
          currentStock: item.currentStock == null || item.currentStock === "" ? null : Math.max(0, Number(item.currentStock || 0)),
        lowStock: Boolean(item.lowStock),
        lineNote: String(item.lineNote || "")
        };
      })
    };
    db.demands.unshift(demand);
    await mutate(db, user, "create", "demand", demand.id, `Raised ${demand.challanNo}`);
    return send(res, 201, demand);
  }

  if (route === "POST /api/dispatches") {
    if (!["admin", "factory"].includes(user.role)) return fail(res, 403, "Only factory or admin can dispatch");
    const body = await getBody(req);
    if (!db.outlets.some((o) => o.id === body.outletId)) return fail(res, 400, "Invalid outlet");
    const error = validateItems(products, body.items);
    if (error) return fail(res, 400, error);
    const photoError = validatePhoto(body.photo);
    if (photoError) return fail(res, 400, photoError);
    const linkedDemand = body.demandId ? db.demands.find((d) => d.id === body.demandId) : null;
    const dispatch = {
      id: id("dispatch"),
      challanNo: `DIS-${businessStamp()}-${db.dispatches.length + 1}`,
      demandId: linkedDemand?.id || null,
      outletId: body.outletId,
      status: "pending_verification",
      note: String(body.note || ""),
      photo: body.photo || null,
      createdAt: nowIso(),
      createdBy: user.username,
      verifiedAt: null,
      verifiedBy: null,
      items: pickDemandItemsForDispatch(linkedDemand, body.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          qty: Number(item.qty),
          unit: product?.unit || "kg",
        receivedQty: null,
        damagedQty: 0,
        excessReturnQty: 0,
        returnReason: ""
        };
      }))
    };
    db.dispatches.unshift(dispatch);
    if (linkedDemand) linkedDemand.status = "dispatched";
    await mutate(db, user, "create", "dispatch", dispatch.id, `Created ${dispatch.challanNo}`);
    return send(res, 201, { ...dispatch, totals: computeDispatch(dispatch) });
  }

  const verifyMatch = url.pathname.match(/^\/api\/dispatches\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyMatch) {
    const dispatch = db.dispatches.find((d) => d.id === verifyMatch[1]);
    if (!dispatch) return fail(res, 404, "Dispatch not found");
    if (!canSeeOutlet(user, dispatch.outletId) || !["admin", "outlet"].includes(user.role)) return fail(res, 403, "Not allowed");
    const body = await getBody(req);
    const received = new Map((body.items || []).map((item) => [item.productId, item]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of dispatch.items) {
      const entry = received.get(item.productId);
      if (!entry) return fail(res, 400, "Every dispatched product must be verified");
      const product = productMap.get(item.productId);
      if (product?.unit === "pcs") {
        for (const [label, value] of [["received", entry.receivedQty], ["damaged", entry.damagedQty], ["excess return", entry.excessReturnQty]]) {
          if (!Number.isInteger(Number(value || 0))) return fail(res, 400, `${product.name} ${label} must be whole pieces`);
        }
      }
      item.receivedQty = Math.max(0, Number(entry.receivedQty || 0));
      item.damagedQty = Math.max(0, Number(entry.damagedQty || 0));
      item.excessReturnQty = Math.max(0, Number(entry.excessReturnQty || 0));
      item.returnReason = String(entry.returnReason || "");
    }
    dispatch.status = "verified";
    dispatch.verifiedAt = nowIso();
    dispatch.verifiedBy = user.username;
    await mutate(db, user, "verify", "dispatch", dispatch.id, `Verified ${dispatch.challanNo}`);
    return send(res, 200, { ...dispatch, totals: computeDispatch(dispatch) });
  }

  const editMatch = url.pathname.match(/^\/api\/dispatches\/([^/]+)$/);
  if (req.method === "PATCH" && editMatch) {
    if (user.role !== "admin") return fail(res, 403, "Only admin can edit dispatches");
    const dispatch = db.dispatches.find((d) => d.id === editMatch[1]);
    if (!dispatch) return fail(res, 404, "Dispatch not found");
    const body = await getBody(req);
    if (Array.isArray(body.items)) {
      const error = validateItems(products, body.items);
      if (error) return fail(res, 400, error);
      dispatch.items = body.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return { ...item, qty: Number(item.qty), unit: product?.unit || "kg" };
      });
    }
    if (typeof body.note === "string") dispatch.note = body.note;
    await mutate(db, user, "admin_edit", "dispatch", dispatch.id, isLocked(dispatch) ? "Admin override after lock" : "Admin edit");
    return send(res, 200, { ...dispatch, totals: computeDispatch(dispatch) });
  }

  if (route === "GET /api/reports") {
    if (user.role !== "admin") return fail(res, 403, "Only admin can view value reports");
    const from = url.searchParams.get("from") || "1970-01-01";
    const to = url.searchParams.get("to") || "2999-12-31";
    const rows = db.dispatches.filter((d) => {
      const date = businessDate(d.createdAt);
      return d.status === "verified" && date >= from && date <= to;
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const outletMap = new Map(db.outlets.map((o) => [o.id, o]));
    const byProduct = new Map();
    const shortages = [];
    for (const d of rows) {
      for (const item of d.items) {
        const p = productMap.get(item.productId);
        const received = Number(item.receivedQty || 0);
        const returned = Number(item.damagedQty || 0) + Number(item.excessReturnQty || 0);
        const sold = Math.max(0, received - returned);
        const shortage = Math.max(0, Number(item.qty || 0) - received);
        const key = item.productId;
        const current = byProduct.get(key) || { productId: key, product: p?.name || key, department: p?.department || "", unit: p?.unit || "kg", soldQty: 0, returnedQty: 0, shortageQty: 0, value: 0 };
        current.soldQty += sold;
        current.returnedQty += returned;
        current.shortageQty += shortage;
        current.value += sold * Number(p?.price || 0);
        byProduct.set(key, current);
        if (shortage > 0 || returned > 0) shortages.push({ dispatchId: d.id, challanNo: d.challanNo, outlet: outletMap.get(d.outletId)?.name || d.outletId, product: p?.name || key, unit: p?.unit || "kg", shortage, returned, date: businessDate(d.createdAt) });
      }
    }
    const movement = [...byProduct.values()].sort((a, b) => b.soldQty - a.soldQty);
    return send(res, 200, {
      summary: {
        verifiedDispatches: rows.length,
        soldQty: movement.reduce((sum, r) => sum + r.soldQty, 0),
        returnedQty: movement.reduce((sum, r) => sum + r.returnedQty, 0),
        shortageQty: movement.reduce((sum, r) => sum + r.shortageQty, 0),
        value: movement.reduce((sum, r) => sum + r.value, 0)
      },
      movement,
      shortages,
      fastMoving: movement.slice(0, 10),
      slowMoving: movement.slice(-10).reverse()
    });
  }

  if (route === "GET /api/exports") {
    if (user.role !== "admin") return fail(res, 403, "Only admin can export reports");
    const kind = url.searchParams.get("kind") || "dispatches";
    const from = url.searchParams.get("from") || "1970-01-01";
    const to = url.searchParams.get("to") || "2999-12-31";
    const productMap = new Map(products.map((p) => [p.id, p]));
    const outletMap = new Map(db.outlets.map((o) => [o.id, o]));
    const rowsInRange = db.dispatches.filter((d) => {
      const date = businessDate(d.createdAt);
      return date >= from && date <= to;
    });
    let rows = [];
    if (kind === "shortages") {
      rows = [["date", "challan", "outlet", "product", "unit", "sent", "received", "shortage", "returned"]];
      for (const d of rowsInRange) {
        for (const item of d.items) {
          const p = productMap.get(item.productId);
          const received = item.receivedQty == null ? "" : Number(item.receivedQty || 0);
          const shortage = item.receivedQty == null ? "" : Math.max(0, Number(item.qty || 0) - received);
          const returned = Number(item.damagedQty || 0) + Number(item.excessReturnQty || 0);
          if (Number(shortage || 0) > 0 || returned > 0) rows.push([businessDate(d.createdAt), d.challanNo, outletMap.get(d.outletId)?.name || d.outletId, p?.name || item.productId, p?.unit || item.unit || "kg", item.qty, received, shortage, returned]);
        }
      }
    } else if (kind === "daily-summary") {
      const grouped = new Map();
      for (const d of rowsInRange) {
        for (const item of d.items) {
          const p = productMap.get(item.productId);
          const key = [businessDate(d.createdAt), d.outletId, item.productId].join("|");
          const row = grouped.get(key) || { date: businessDate(d.createdAt), outlet: outletMap.get(d.outletId)?.name || d.outletId, product: p?.name || item.productId, unit: p?.unit || item.unit || "kg", sent: 0, received: 0, returned: 0 };
          row.sent += Number(item.qty || 0);
          row.received += Number(item.receivedQty || 0);
          row.returned += Number(item.damagedQty || 0) + Number(item.excessReturnQty || 0);
          grouped.set(key, row);
        }
      }
      rows = [["date", "outlet", "product", "unit", "sent", "received", "returned", "sold_after_returns"], ...[...grouped.values()].map((r) => [r.date, r.outlet, r.product, r.unit, r.sent, r.received, r.returned, Math.max(0, r.received - r.returned)])];
    } else {
      rows = [["date", "challan", "outlet", "status", "product", "unit", "dispatched", "received", "damaged", "excess_return"]];
      for (const d of rowsInRange) {
        for (const item of d.items) {
          const p = productMap.get(item.productId);
          rows.push([businessDate(d.createdAt), d.challanNo, outletMap.get(d.outletId)?.name || d.outletId, d.status, p?.name || item.productId, p?.unit || item.unit || "kg", item.qty, item.receivedQty ?? "", item.damagedQty || 0, item.excessReturnQty || 0]);
        }
      }
    }
    const csv = toCsv(rows);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${from}-to-${to}.csv"`,
      "cache-control": "no-store"
    });
    return res.end(csv);
  }

  fail(res, 404, "API route not found");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const fullPath = path.resolve(path.join(PUBLIC_DIR, file));
  const relative = path.relative(PUBLIC_DIR, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return fail(res, 403, "Forbidden");
  try {
    const data = await fsp.readFile(fullPath);
    send(res, 200, data, mime[path.extname(fullPath)] || "application/octet-stream");
  } catch {
    const index = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
    send(res, 200, index, "text/html; charset=utf-8");
  }
}

async function main() {
  const db = await seedDb();
  await enforceProductionPasswords(db);
  const server = http.createServer(async (req, res) => {
    try {
      const freshDb = await seedDb();
      const products = await readJson(PRODUCT_PATH, []);
      if (req.url.startsWith("/api/")) await handleApi(req, res, freshDb, products);
      else await serveStatic(req, res);
    } catch (error) {
      console.error(error);
      fail(res, error.statusCode || 500, error.message || "Server error");
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`Mithai Dispatch PWA running on http://${HOST}:${PORT}`);
    if (process.env.NODE_ENV !== "production") {
      console.log("Demo logins: admin/admin123, factory/factory123, vijay/outlet123, mainoutlet/outlet123");
    }
  });
}

main();

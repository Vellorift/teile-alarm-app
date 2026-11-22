// Teile-Alarm – web app.
//  - "Meine Teile": edit the part list stored as teile.json in a private
//    GitHub repo (read by the PC before every search run).
//  - "Gerät & Push": subscribe this device to Web Push.
// All rendering uses textContent (never innerHTML) to keep user data inert.
"use strict";

const $ = (id) => document.getElementById(id);
const CFG = window.TEILE_ALARM_CONFIG || {};
const KEY = CFG.vapidPublicKey || "";
const REPO = CFG.dataRepo || "";
const TOKEN_KEY = "teileAlarmGithubToken";
const MAX_ACTIVE = 30; // eBay allows ~5000 searches/day -> ~30 parts at 10 min

function show(id, visible = true) {
  $(id).classList.toggle("hidden", !visible);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function selectTab(name) {
  $("tab-teile").classList.toggle("active", name === "teile");
  $("tab-geraet").classList.toggle("active", name === "geraet");
  show("view-teile", name === "teile");
  show("view-geraet", name === "geraet");
}
$("tab-teile").addEventListener("click", () => selectTab("teile"));
$("tab-geraet").addEventListener("click", () => selectTab("geraet"));

// ---------------------------------------------------------------------------
// Local storage (may be unavailable in some contexts)
// ---------------------------------------------------------------------------

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
function setToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// GitHub data repo (teile.json)
// ---------------------------------------------------------------------------

const FILE_URL = `https://api.github.com/repos/${REPO}/contents/teile.json`;
let data = { version: 1, teile: [] };
let sha = null;

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function gh(method, body) {
  return fetch(FILE_URL, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function explain(status) {
  if (status === 401) return "Zugangsschlüssel ungültig oder abgelaufen.";
  if (status === 403) return "Zugangsschlüssel hat keine Berechtigung (Contents: Read and write).";
  if (status === 404) return "Repo nicht gefunden oder der Schlüssel hat keinen Zugriff darauf.";
  return `GitHub antwortet mit Fehler ${status}.`;
}

async function loadParts() {
  const res = await gh("GET");
  if (res.status === 404) {
    // Repo reachable? An empty repo / missing file is fine, no access is not.
    const repoRes = await fetch(`https://api.github.com/repos/${REPO}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${getToken()}`, Accept: "application/vnd.github+json" },
    });
    if (!repoRes.ok) throw new Error(explain(repoRes.status));
    data = { version: 1, teile: [] };
    sha = null;
    return;
  }
  if (!res.ok) throw new Error(explain(res.status));
  const json = await res.json();
  const parsed = JSON.parse(b64ToUtf8(json.content));
  data = { version: 1, teile: Array.isArray(parsed.teile) ? parsed.teile : [] };
  sha = json.sha;
}

async function saveParts(message) {
  const res = await gh("PUT", {
    message,
    content: utf8ToB64(JSON.stringify(data, null, 2) + "\n"),
    ...(sha ? { sha } : {}),
  });
  if (res.status === 409 || res.status === 422) {
    await loadParts();
    render();
    const err = new Error("Die Liste wurde zwischendurch woanders geändert. Sie ist jetzt neu geladen, bitte nochmal.");
    err.reloaded = true; // local data already replaced by the fresh copy
    throw err;
  }
  if (!res.ok) throw new Error(explain(res.status));
  const json = await res.json();
  sha = json.content.sha;
}

// ---------------------------------------------------------------------------
// Rendering the list
// ---------------------------------------------------------------------------

function setMsg(text, cls) {
  const el = $("parts-msg");
  el.textContent = text || "";
  el.className = "msg " + (cls || "");
}

function euro(value) {
  return Number(value).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render() {
  const list = $("parts-list");
  list.replaceChildren();
  if (data.teile.length === 0) {
    list.append(el("p", "empty", "Noch keine Teile. Leg das erste an."));
  }
  data.teile.forEach((part, index) => {
    const card = el("div", "part" + (part.aktiv === false ? " paused" : ""));
    const info = el("button", "part-info");
    info.append(el("span", "part-name", part.name));
    const details = [`„${part.suche}“`];
    if (part.max_preis) details.push(`bis ${euro(part.max_preis)}`);
    if (part.zustand && part.zustand !== "egal") details.push(part.zustand);
    info.append(el("span", "part-details", details.join(" · ")));
    if (part.ausschluss && part.ausschluss.length) {
      info.append(el("span", "part-extra", "ohne: " + part.ausschluss.join(", ")));
    }
    info.addEventListener("click", () => openEditor(index));

    const toggle = el("label", "switch");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = part.aktiv !== false;
    box.setAttribute("aria-label", "aktiv");
    box.addEventListener("change", () => toggleActive(index, box));
    toggle.append(box, el("span", "slider"));

    card.append(info, toggle);
    list.append(card);
  });
  const active = data.teile.filter((p) => p.aktiv !== false).length;
  $("parts-count").textContent = `${active} aktiv, ${data.teile.length} insgesamt` +
    (active > MAX_ACTIVE ? ` – mehr als ${MAX_ACTIVE} aktive Teile schafft eBay im 10-Minuten-Takt nicht.` : "");
}

async function toggleActive(index, box) {
  box.disabled = true;
  const before = data.teile[index].aktiv !== false;
  data.teile[index].aktiv = box.checked;
  try {
    await saveParts(`${box.checked ? "Aktiviert" : "Pausiert"}: ${data.teile[index].name}`);
    setMsg(box.checked ? "Aktiviert." : "Pausiert.", "ok");
  } catch (err) {
    if (!err.reloaded) data.teile[index].aktiv = before;
    setMsg(err.message, "err");
  }
  render();
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

let editIndex = -1;

function words(text) {
  return text.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 20).map((w) => w.slice(0, 40));
}

function openEditor(index) {
  editIndex = index;
  const p = index >= 0 ? data.teile[index] : { aktiv: true, zustand: "egal" };
  $("editor-title").textContent = index >= 0 ? "Teil bearbeiten" : "Neues Teil";
  $("f-name").value = p.name || "";
  $("f-suche").value = p.suche || "";
  $("f-preis").value = p.max_preis ? String(p.max_preis).replace(".", ",") : "";
  $("f-zustand").value = p.zustand || "egal";
  $("f-aus").value = (p.ausschluss || []).join(", ");
  $("f-muss").value = (p.muss_enthalten || []).join(", ");
  $("f-aktiv").checked = p.aktiv !== false;
  show("btn-delete", index >= 0);
  show("parts-area", false);
  show("editor", true);
  $("f-name").focus();
}

function closeEditor() {
  show("editor", false);
  show("parts-area", true);
}

$("btn-add").addEventListener("click", () => openEditor(-1));
$("btn-cancel").addEventListener("click", closeEditor);

$("btn-save").addEventListener("click", async () => {
  const name = $("f-name").value.trim();
  const suche = $("f-suche").value.trim();
  if (!name || !suche) {
    alert("Name und Suchbegriff sind Pflicht.");
    return;
  }
  const price = parseFloat(String($("f-preis").value).replace(",", "."));
  const part = {
    id: editIndex >= 0 && data.teile[editIndex].id ? data.teile[editIndex].id : crypto.randomUUID(),
    name: name.slice(0, 80),
    suche: suche.slice(0, 100),
    zustand: $("f-zustand").value,
    ausschluss: words($("f-aus").value),
    muss_enthalten: words($("f-muss").value),
    aktiv: $("f-aktiv").checked,
  };
  if (price > 0) part.max_preis = Math.round(price * 100) / 100;

  const backup = JSON.stringify(data.teile);
  if (editIndex >= 0) data.teile[editIndex] = part;
  else data.teile.push(part);
  $("btn-save").disabled = true;
  try {
    await saveParts(`${editIndex >= 0 ? "Geändert" : "Neu"}: ${part.name}`);
    closeEditor();
    setMsg("Gespeichert. Gilt ab dem nächsten Suchlauf (spätestens in 10 Minuten).", "ok");
  } catch (err) {
    if (!err.reloaded) data.teile = JSON.parse(backup);
    else closeEditor();
    alert(err.message);
  } finally {
    $("btn-save").disabled = false;
    render();
  }
});

$("btn-delete").addEventListener("click", async () => {
  const part = data.teile[editIndex];
  if (!confirm(`„${part.name}“ wirklich löschen?`)) return;
  const backup = JSON.stringify(data.teile);
  data.teile.splice(editIndex, 1);
  try {
    await saveParts(`Gelöscht: ${part.name}`);
    closeEditor();
    setMsg("Gelöscht.", "ok");
  } catch (err) {
    if (!err.reloaded) data.teile = JSON.parse(backup);
    else closeEditor();
    alert(err.message);
  }
  render();
});

// ---------------------------------------------------------------------------
// Connecting to the data repo
// ---------------------------------------------------------------------------

async function startParts() {
  $("repo-name").textContent = REPO;
  $("repo-name-2").textContent = REPO;
  if (!REPO) {
    show("connect-card", false);
    setMsg("In config.js ist kein Daten-Repo eingetragen.", "err");
    show("parts-area");
    return;
  }
  if (!getToken()) {
    show("connect-card", true);
    show("parts-area", false);
    show("gh-card", false);
    return;
  }
  show("connect-card", false);
  show("gh-card", true);
  show("parts-area", true);
  setMsg("Lade Teileliste …");
  try {
    await loadParts();
    setMsg("");
  } catch (err) {
    setMsg(err.message, "err");
  }
  render();
}

$("btn-connect").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
    alert("Das sieht nicht nach einem GitHub-Zugangsschlüssel aus (beginnt mit github_pat_).");
    return;
  }
  setToken(token);
  $("token").value = "";
  await startParts();
});

$("btn-disconnect").addEventListener("click", () => {
  if (!confirm("Zugangsschlüssel von diesem Gerät löschen? Die Teileliste selbst bleibt erhalten.")) return;
  setToken("");
  data = { version: 1, teile: [] };
  sha = null;
  render();
  startParts();
  selectTab("teile");
});

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

function setStatus(text, cls) {
  const s = $("status");
  s.textContent = text;
  s.className = cls || "";
}

function b64uToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function getRegistration() {
  return navigator.serviceWorker.register("sw.js", { scope: "./" });
}

function showCode(sub) {
  const json = sub.toJSON();
  $("code").value = JSON.stringify({ endpoint: json.endpoint, keys: json.keys });
  show("code-card");
  show("tools-card");
  show("setup-card", false);
}

async function refreshPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    show("ios-hint", isIOS && !isStandalone);
    setStatus(isIOS && !isStandalone
      ? "Erst zum Home-Bildschirm hinzufügen (siehe unten)."
      : "Dieser Browser unterstützt keine Push-Benachrichtigungen. Bitte Chrome verwenden.", "err");
    $("btn-enable").disabled = true;
    return false;
  }
  if (!KEY || KEY.startsWith("HIER_")) {
    setStatus("config.js enthält noch keinen Push-Schlüssel.", "err");
    $("btn-enable").disabled = true;
    return false;
  }
  if (Notification.permission === "denied") {
    setStatus("Benachrichtigungen sind für diese Seite blockiert. In den Website-Einstellungen wieder erlauben.", "err");
    $("btn-enable").disabled = true;
    return false;
  }
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    setStatus("✓ Dieses Gerät empfängt Benachrichtigungen.", "ok");
    showCode(sub);
    return true;
  }
  setStatus("Dieses Gerät ist noch nicht angemeldet.", "warn");
  return false;
}

$("btn-enable").addEventListener("click", async () => {
  $("btn-enable").disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setStatus("Ohne Erlaubnis keine Benachrichtigungen.", "err");
      return;
    }
    const reg = await getRegistration();
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(KEY) });
    setStatus("✓ Angemeldet. Jetzt den Abo-Code zum PC bringen.", "ok");
    showCode(sub);
  } catch (err) {
    setStatus("Fehler beim Anmelden: " + err.message, "err");
  } finally {
    $("btn-enable").disabled = false;
  }
});

$("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code").value);
    $("copy-msg").textContent = "Kopiert.";
  } catch {
    $("code").select();
    $("copy-msg").textContent = "Bitte manuell markieren und kopieren.";
  }
});

if (navigator.share) {
  show("btn-share");
  $("btn-share").addEventListener("click", () => {
    navigator.share({ title: "Teile-Alarm Abo-Code", text: $("code").value }).catch(() => {});
  });
}

$("btn-local-test").addEventListener("click", async () => {
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification("Teile-Alarm Test", {
    body: "Wenn du das siehst, zeigt dieses Gerät Benachrichtigungen an.",
    icon: "icon-192.png",
    badge: "badge.png",
  });
});

$("btn-disable").addEventListener("click", async () => {
  if (!confirm("Push auf diesem Gerät abmelden?")) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  $("code").value = "";
  show("code-card", false);
  show("tools-card", false);
  show("setup-card");
  setStatus("Abgemeldet. Am PC wird das alte Abo beim nächsten Senden automatisch entfernt.", "warn");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

startParts();
refreshPush()
  .then((subscribed) => { if (!subscribed) selectTab("geraet"); })
  .catch((err) => { setStatus("Fehler: " + err.message, "err"); selectTab("geraet"); });

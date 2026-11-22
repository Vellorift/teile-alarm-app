// Teile-Alarm – page logic. Subscribes this device to Web Push and shows
// the subscription code that the PC script needs.
"use strict";

const $ = (id) => document.getElementById(id);
const KEY = (window.TEILE_ALARM_CONFIG || {}).vapidPublicKey || "";

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "";
}

function show(id, visible = true) {
  $(id).classList.toggle("hidden", !visible);
}

function b64uToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function getRegistration() {
  return navigator.serviceWorker.register("sw.js", { scope: "./" });
}

function showCode(sub) {
  const json = sub.toJSON();
  const code = JSON.stringify({ endpoint: json.endpoint, keys: json.keys });
  $("code").value = code;
  show("code-card");
  show("tools-card");
  show("setup-card", false);
}

async function refresh() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    show("ios-hint", isIOS && !isStandalone);
    setStatus(isIOS && !isStandalone
      ? "Erst zum Home-Bildschirm hinzufügen (siehe unten)."
      : "Dieser Browser unterstützt keine Push-Benachrichtigungen. Bitte Chrome verwenden.", "err");
    $("btn-enable").disabled = true;
    return;
  }
  if (!KEY || KEY.startsWith("HIER_")) {
    setStatus("config.js enthält noch keinen Schlüssel. Am PC py -3.13 alarm.py --vapid-keys ausführen und den öffentlichen Schlüssel an Claude schicken.", "err");
    $("btn-enable").disabled = true;
    return;
  }
  if (Notification.permission === "denied") {
    setStatus("Benachrichtigungen sind für diese Seite blockiert. In den Browser-/Website-Einstellungen wieder erlauben.", "err");
    $("btn-enable").disabled = true;
    return;
  }
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    setStatus("✓ Dieses Gerät ist angemeldet.", "ok");
    showCode(sub);
  } else {
    setStatus("Dieses Gerät ist noch nicht angemeldet.", "warn");
  }
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
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToBytes(KEY),
    });
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
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  $("code").value = "";
  show("code-card", false);
  show("tools-card", false);
  show("setup-card");
  setStatus("Abgemeldet. Den Code am PC kannst du löschen (abo.json).", "warn");
});

refresh().catch((err) => setStatus("Fehler: " + err.message, "err"));

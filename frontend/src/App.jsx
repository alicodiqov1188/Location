import React, { useEffect, useState, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GUEST_POLL_MS = 15000; // how often guests re-fetch admin position + points
const ADMIN_SEND_INTERVAL_MS = 10000; // how often the admin pushes a GPS fix

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICON_EMOJI = {
  home: "🏠",
  office: "🏢",
  cafe: "☕",
  pin: "📍",
};

function emojiDivIcon(emoji, size = 34) {
  return L.divIcon({
    html: `<div style="font-size:${size}px; line-height:1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4));">${emoji}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function adminDivIcon(isOnline) {
  const color = isOnline ? "#22c55e" : "#9ca3af";
  return L.divIcon({
    html: `
      <div style="position:relative; width:22px; height:22px;">
        ${isOnline ? `<div style="position:absolute; inset:-8px; border-radius:50%; background:${color}; opacity:0.35; animation:pulse 1.8s infinite;"></div>` : ""}
        <div style="position:absolute; inset:0; border-radius:50%; background:${color}; border:3px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>
      </div>
      <style>
        @keyframes pulse { 0% { transform: scale(0.6); opacity:0.5; } 70% { transform: scale(1.8); opacity:0; } 100% { opacity:0; } }
      </style>
    `,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoString) {
  if (!isoString) return "hech qachon";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "hozirgina";
  if (diffSec < 60) return `${diffSec} soniya oldin`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} daqiqa oldin`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} soat oldin`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} kun oldin`;
}

function authFields(telegramUser) {
  return {
    telegram_id: String(telegramUser?.id ?? ""),
    init_data: window.Telegram?.WebApp?.initData || null,
  };
}

function RecenterOnce({ lat, lng }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current && lat != null && lng != null) {
      map.setView([lat, lng], 15);
      done.current = true;
    }
  }, [lat, lng, map]);
  return null;
}

// ---------------------------------------------------------------------------
// Point form modal — used for both "add" and "edit"
// ---------------------------------------------------------------------------

function PointModal({ initialValues, onClose, onSave, saving }) {
  const [title, setTitle] = useState(initialValues.title || "");
  const [description, setDescription] = useState(initialValues.description || "");
  const [lat, setLat] = useState(initialValues.latitude ?? "");
  const [lng, setLng] = useState(initialValues.longitude ?? "");
  const [iconType, setIconType] = useState(initialValues.icon_type || "pin");

  const canSave = title.trim().length > 0 && lat !== "" && lng !== "";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[2000] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">
          {initialValues.id ? "Nuqtani tahrirlash" : "Yangi nuqta qo'shish"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500">Nomi</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: Uy, Ishxona, Sevimli kafe"
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Tavsif (ixtiyoriy)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Belgisi</label>
            <div className="flex gap-2 mt-1">
              {Object.entries(ICON_EMOJI).map(([key, emoji]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIconType(key)}
                  className={`flex-1 py-2 rounded-lg border text-lg ${
                    iconType === key ? "border-blue-500 bg-blue-50" : "border-gray-200"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500">Latitude</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Longitude</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Maslahat: koordinatalarni Google Maps'dan nusxalab, shu yerga joylashtirishingiz mumkin.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium"
          >
            Bekor qilish
          </button>
          <button
            disabled={!canSave || saving}
            onClick={() =>
              onSave({
                title: title.trim(),
                description: description.trim() || null,
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                icon_type: iconType,
              })
            }
            className="flex-1 py-2.5 rounded-xl bg-blue-600 disabled:bg-blue-300 text-white font-semibold"
          >
            {saving ? "Saqlanmoqda..." : "Saqlash"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest View — read-only map for everyone except the admin
// ---------------------------------------------------------------------------

function GuestView() {
  const [state, setState] = useState({ status: "loading", admin: null, points: [] });
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/public-location`);
      setState({ status: "success", admin: res.data.admin, points: res.data.points });
    } catch (err) {
      setState((prev) => ({ ...prev, status: "error" }));
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, GUEST_POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  if (state.status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Xarita yuklanmoqda...</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 px-6 text-center">
        <p className="text-red-500">Ma'lumotlarni yuklab bo'lmadi. Birozdan so'ng qayta urinib ko'ring.</p>
      </div>
    );
  }

  const { admin, points } = state;
  const hasAdminPosition = admin.latitude != null && admin.longitude != null;
  const mapCenter = hasAdminPosition
    ? [admin.latitude, admin.longitude]
    : points.length > 0
    ? [points[0].latitude, points[0].longitude]
    : [41.2995, 69.2401]; // fallback: Tashkent

  return (
    <div className="h-screen w-screen relative">
      <MapContainer center={mapCenter} zoom={14} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {hasAdminPosition && (
          <Marker position={[admin.latitude, admin.longitude]} icon={adminDivIcon(admin.is_online)}>
            <Popup>
              {admin.is_online ? "🟢 Hozir onlayn" : `⚪ Oxirgi marta: ${timeAgo(admin.last_seen)}`}
            </Popup>
          </Marker>
        )}

        {points.map((p) => (
          <Marker key={p.id} position={[p.latitude, p.longitude]} icon={emojiDivIcon(ICON_EMOJI[p.icon_type] || ICON_EMOJI.pin)}>
            <Popup>
              <div className="font-semibold">{p.title}</div>
              {p.description && <div className="text-sm text-gray-600">{p.description}</div>}
            </Popup>
          </Marker>
        ))}

        {hasAdminPosition && <RecenterOnce lat={admin.latitude} lng={admin.longitude} />}
      </MapContainer>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur shadow-lg rounded-full px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 z-[1000]">
        <span className={`w-2 h-2 rounded-full ${admin.is_online ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
        {admin.is_online ? "Hozir onlayn" : `Oxirgi marta: ${timeAgo(admin.last_seen)}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin View — live tracking + static points management
// ---------------------------------------------------------------------------

function AdminView({ telegramUser }) {
  const [tracking, setTracking] = useState(false);
  const [currentPos, setCurrentPos] = useState(null); // { lat, lng }
  const [points, setPoints] = useState([]);
  const [statusMsg, setStatusMsg] = useState(null);
  const [modalState, setModalState] = useState(null); // null | { id?, title, description, latitude, longitude, icon_type }
  const [saving, setSaving] = useState(false);

  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);

  const showStatus = (type, text) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg((s) => (s?.text === text ? null : s)), 4000);
  };

  const loadPoints = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/public-location`);
      setPoints(res.data.points);
      if (res.data.admin.latitude != null) {
        setCurrentPos({ lat: res.data.admin.latitude, lng: res.data.admin.longitude });
      }
    } catch {
      // silent — guest view has its own error handling; admin panel just retries next poll
    }
  }, []);

  useEffect(() => {
    loadPoints();
  }, [loadPoints]);

  // Center the map on the admin's real location as soon as the page opens —
  // a one-shot GPS read, independent of the "start tracking" toggle, so the
  // map never sits on the Tashkent fallback while waiting for a button press.
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentPos((prev) => prev ?? { lat: position.coords.latitude, lng: position.coords.longitude });
        },
        () => {
          /* silent — falls back to Tashkent center if permission denied */
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }, []);

  const sendLocation = useCallback(
    async (lat, lng) => {
      try {
        await axios.post(`${API_URL}/api/admin/update-location`, {
          ...authFields(telegramUser),
          lat,
          lng,
        });
      } catch (err) {
        const detail = err.response?.data?.detail || err.message;
        showStatus("error", `Yuborishda xatolik: ${detail}`);
      }
    },
    [telegramUser]
  );

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      showStatus("error", "Bu qurilmada GPS qo'llab-quvvatlanmaydi.");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentPos({ lat: latitude, lng: longitude });

        const now = Date.now();
        if (now - lastSentRef.current >= ADMIN_SEND_INTERVAL_MS) {
          lastSentRef.current = now;
          sendLocation(latitude, longitude);
        }
      },
      (error) => showStatus("error", `GPS xatosi: ${error.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    setTracking(true);
    showStatus("info", "Jonli kuzatish yoqildi — har 10 soniyada yangilanadi.");
  }, [sendLocation]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    showStatus("info", "Jonli kuzatish o'chirildi.");
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const openAddModal = () => {
    setModalState({
      title: "",
      description: "",
      latitude: currentPos?.lat ?? "",
      longitude: currentPos?.lng ?? "",
      icon_type: "pin",
    });
  };

  const openEditModal = (point) => setModalState({ ...point });

  const handleSavePoint = async (values) => {
    setSaving(true);
    try {
      if (modalState.id) {
        await axios.put(`${API_URL}/api/admin/update-point/${modalState.id}`, {
          ...authFields(telegramUser),
          title: values.title,
          description: values.description,
          lat: values.lat,
          lng: values.lng,
          icon_type: values.icon_type,
        });
        showStatus("success", "Nuqta yangilandi.");
      } else {
        await axios.post(`${API_URL}/api/admin/add-point`, {
          ...authFields(telegramUser),
          title: values.title,
          description: values.description,
          lat: values.lat,
          lng: values.lng,
          icon_type: values.icon_type,
        });
        showStatus("success", "Yangi nuqta qo'shildi.");
      }
      setModalState(null);
      loadPoints();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      showStatus("error", `Saqlashda xatolik: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePoint = async (point) => {
    if (!window.confirm(`"${point.title}" nuqtasini o'chirmoqchimisiz?`)) return;
    try {
      await axios.delete(`${API_URL}/api/admin/delete-point/${point.id}`, {
        data: authFields(telegramUser),
      });
      showStatus("success", "Nuqta o'chirildi.");
      loadPoints();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      showStatus("error", `O'chirishda xatolik: ${detail}`);
    }
  };

  const statusColors = {
    success: "bg-green-100 text-green-800 border-green-300",
    error: "bg-red-100 text-red-800 border-red-300",
    info: "bg-blue-100 text-blue-800 border-blue-300",
  };

  const mapCenter = currentPos ? [currentPos.lat, currentPos.lng] : [41.2995, 69.2401];

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-50">
      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer center={mapCenter} zoom={14} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {currentPos && (
            <Marker position={[currentPos.lat, currentPos.lng]} icon={adminDivIcon(tracking)}>
              <Popup>Sizning joriy joylashuvingiz</Popup>
            </Marker>
          )}
          {points.map((p) => (
            <Marker key={p.id} position={[p.latitude, p.longitude]} icon={emojiDivIcon(ICON_EMOJI[p.icon_type] || ICON_EMOJI.pin)}>
              <Popup>
                <div className="font-semibold">{p.title}</div>
                {p.description && <div className="text-sm text-gray-600">{p.description}</div>}
              </Popup>
            </Marker>
          ))}
          {currentPos && <RecenterOnce lat={currentPos.lat} lng={currentPos.lng} />}
        </MapContainer>

        {statusMsg && (
          <div
            className={`absolute top-4 left-1/2 -translate-x-1/2 border rounded-full px-4 py-2 text-sm font-medium shadow-lg z-[1000] ${statusColors[statusMsg.type]}`}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Control panel */}
      <div className="bg-white border-t border-gray-200 p-4 space-y-3 max-h-[45vh] overflow-y-auto">
        <div className="flex gap-2">
          <button
            onClick={tracking ? stopTracking : startTracking}
            className={`flex-1 py-3 rounded-xl font-semibold text-white ${
              tracking ? "bg-red-500" : "bg-green-600"
            }`}
          >
            {tracking ? "⏹ Kuzatishni to'xtatish" : "📍 Jonli kuzatishni yoqish"}
          </button>
          <button
            onClick={openAddModal}
            className="px-4 py-3 rounded-xl bg-blue-600 text-white font-semibold"
          >
            + Nuqta
          </button>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Statik nuqtalar ({points.length})</h3>
          <div className="space-y-2">
            {points.length === 0 && <p className="text-sm text-gray-400">Hali nuqta qo'shilmagan.</p>}
            {points.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{ICON_EMOJI[p.icon_type] || ICON_EMOJI.pin}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{p.title}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEditModal(p)}
                    className="text-xs px-2 py-1 rounded-md bg-gray-200 text-gray-700"
                  >
                    Tahrirlash
                  </button>
                  <button
                    onClick={() => handleDeletePoint(p)}
                    className="text-xs px-2 py-1 rounded-md bg-red-100 text-red-700"
                  >
                    O'chirish
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalState && (
        <PointModal
          initialValues={modalState}
          onClose={() => setModalState(null)}
          onSave={handleSavePoint}
          saving={saving}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App — detects Telegram context and resolves Admin vs Guest role
// ---------------------------------------------------------------------------

export default function App() {
  const [phase, setPhase] = useState("detecting"); // detecting | guest | admin
  const [telegramUser, setTelegramUser] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (tg && tg.initDataUnsafe?.user) {
      tg.ready();
      tg.expand();
      const user = tg.initDataUnsafe.user;
      setTelegramUser(user);

      axios
        .get(`${API_URL}/api/role`, { params: { telegram_id: String(user.id) } })
        .then((res) => setPhase(res.data.role === "admin" ? "admin" : "guest"))
        .catch(() => setPhase("guest")); // fail safe: never fall into admin mode on error
    } else {
      // Not inside Telegram at all → always the read-only guest map.
      setPhase("guest");
    }
  }, []);

  if (phase === "detecting") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-400 text-sm">Yuklanmoqda...</p>
      </div>
    );
  }

  return phase === "admin" ? <AdminView telegramUser={telegramUser} /> : <GuestView />;
}
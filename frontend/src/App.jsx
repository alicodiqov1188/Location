import React, { useEffect, useState, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Set this to your deployed backend URL (e.g. via Vite env var VITE_API_URL)
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const POLL_INTERVAL_MS = 30000; // 30 seconds

// Custom marker icon (default Leaflet icon paths break under bundlers)
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoString) {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function RecenterMap({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

// ---------------------------------------------------------------------------
// Admin View — rendered inside Telegram Mini App
// ---------------------------------------------------------------------------

function AdminView({ telegramUser }) {
  const [isPublic, setIsPublic] = useState(true);
  const [statusMsg, setStatusMsg] = useState(null); // { type: 'success'|'error'|'info', text }
  const [lastLocation, setLastLocation] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpdateLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setStatusMsg({ type: "error", text: "Geolocation is not supported on this device." });
      return;
    }

    setLoading(true);
    setStatusMsg({ type: "info", text: "Requesting GPS position..." });

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        try {
          const res = await axios.post(`${API_URL}/api/admin/location`, {
            lat: latitude,
            lng: longitude,
            is_public: isPublic,
            telegram_id: String(telegramUser?.id ?? ""),
            init_data: window.Telegram?.WebApp?.initData || null,
          });

          setLastLocation({ lat: latitude, lng: longitude, updatedAt: res.data.data.updatedAt });
          setStatusMsg({ type: "success", text: "Location updated successfully!" });
        } catch (err) {
          const detail = err.response?.data?.detail || err.message;
          setStatusMsg({ type: "error", text: `Failed to update: ${detail}` });
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        setLoading(false);
        setStatusMsg({ type: "error", text: `GPS error: ${error.message}` });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [isPublic, telegramUser]);

  const statusColors = {
    success: "bg-green-100 text-green-800 border-green-300",
    error: "bg-red-100 text-red-800 border-red-300",
    info: "bg-blue-100 text-blue-800 border-blue-300",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-gray-900">📍 Location Admin</h1>
          <p className="text-sm text-gray-500">
            {telegramUser?.first_name ? `Hi, ${telegramUser.first_name}` : "Admin Panel"}
          </p>
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-gray-700">Publicly Visible</span>
          <button
            onClick={() => setIsPublic((v) => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isPublic ? "bg-green-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                isPublic ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <button
          onClick={handleUpdateLocation}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold transition-colors"
        >
          {loading ? "Updating..." : "📍 Update My Location"}
        </button>

        {statusMsg && (
          <div className={`text-sm border rounded-lg px-3 py-2 ${statusColors[statusMsg.type]}`}>
            {statusMsg.text}
          </div>
        )}

        {lastLocation && (
          <div className="text-xs text-gray-400 text-center">
            Last sent: {lastLocation.lat.toFixed(5)}, {lastLocation.lng.toFixed(5)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public View — rendered in a normal browser (bio link)
// ---------------------------------------------------------------------------

function PublicView() {
  const [locationData, setLocationData] = useState(null); // { lat, lng, updatedAt }
  const [status, setStatus] = useState("loading"); // loading | success | hidden | error
  const intervalRef = useRef(null);

  const fetchLocation = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/public/location`);
      if (res.data.status === "success") {
        setLocationData(res.data.data);
        setStatus("success");
      } else {
        setStatus("hidden");
      }
    } catch (err) {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchLocation();
    intervalRef.current = setInterval(fetchLocation, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchLocation]);

  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading map...</p>
      </div>
    );
  }

  if (status === "hidden") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 px-6 text-center">
        <p className="text-gray-500">Location sharing is currently turned off.</p>
      </div>
    );
  }

  if (status === "error" || !locationData) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 px-6 text-center">
        <p className="text-red-500">Could not load location. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative">
      <MapContainer
        center={[locationData.lat, locationData.lng]}
        zoom={15}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[locationData.lat, locationData.lng]} icon={markerIcon}>
          <Popup>Current location</Popup>
        </Marker>
        <RecenterMap lat={locationData.lat} lng={locationData.lng} />
      </MapContainer>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur shadow-lg rounded-full px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 z-[1000]">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        Last updated {timeAgo(locationData.updatedAt)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App — detects environment and routes to the right view
// ---------------------------------------------------------------------------

export default function App() {
  const [isTelegram, setIsTelegram] = useState(null); // null = detecting
  const [telegramUser, setTelegramUser] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (tg && tg.initDataUnsafe?.user) {
      tg.ready();
      tg.expand();
      setTelegramUser(tg.initDataUnsafe.user);
      setIsTelegram(true);
    } else {
      setIsTelegram(false);
    }
  }, []);

  if (isTelegram === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-400 text-sm">Detecting environment...</p>
      </div>
    );
  }

  return isTelegram ? <AdminView telegramUser={telegramUser} /> : <PublicView />;
}

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

type NotifPrefs = {
  email_alerts: boolean;
  sms_alerts: boolean;
  slack_alerts: boolean;
  push_alerts: boolean;
  alert_threshold_cents: number;
};

const DEFAULT_PREFS: NotifPrefs = {
  email_alerts:           true,
  sms_alerts:             false,
  slack_alerts:           false,
  push_alerts:            false,
  alert_threshold_cents:  2500,
};

const THRESHOLD_OPTIONS = [
  { label: "$10 (catch everything)", value: 1000 },
  { label: "$25 (default)",          value: 2500 },
  { label: "$50",                    value: 5000 },
  { label: "$100",                   value: 10000 },
  { label: "$250 (high value only)", value: 25000 },
];

export default function SettingsPage() {
  const [prefs, setPrefs]       = useState<NotifPrefs>(DEFAULT_PREFS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Profile state
  const [email, setEmail]         = useState("");
  const [phone, setPhone]         = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved]   = useState(false);
  const [profileError, setProfileError]   = useState<string | null>(null);

  const sb = useMemo(() => createClient(), []);

  const loadSettings = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    setEmail(user.email ?? "");

    // Load user row from DB for phone + notification prefs
    const { data } = await sb
      .from("users")
      .select("phone, notification_prefs")
      .eq("id", user.id)
      .single();

    if (data) {
      setPhone(data.phone ?? "");
      if (data.notification_prefs) {
        setPrefs({ ...DEFAULT_PREFS, ...data.notification_prefs });
      }
    }
    setLoading(false);
  }, [sb]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function savePrefs(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    const { error: err } = await sb
      .from("users")
      .update({ notification_prefs: prefs })
      .eq("id", user.id);

    if (err) {
      setError(err.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError(null);
    setProfileSaved(false);

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    const { error: err } = await sb
      .from("users")
      .update({ phone: phone || null })
      .eq("id", user.id);

    if (err) {
      setProfileError(err.message);
    } else {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    }
    setProfileSaving(false);
  }

  async function toggle(key: keyof NotifPrefs) {
    const newVal = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: newVal }));

    // Handle push subscription when toggling push_alerts
    if (key === "push_alerts") {
      if (newVal) {
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            setPrefs((p) => ({ ...p, push_alerts: false }));
            setError("Push notification permission denied. Enable it in your browser settings.");
            return;
          }
          // Register push subscription
          const reg = await navigator.serviceWorker.ready;
          const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
          const vapidResp = await fetch(`${apiUrl}/push/vapid-key`);
          if (!vapidResp.ok) throw new Error("Push not configured on server");
          const { vapid_public_key } = await vapidResp.json();

          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapid_public_key,
          });
          const subJson = sub.toJSON();

          const { data: { session } } = await sb.auth.getSession();
          await fetch(`${apiUrl}/push/subscribe`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              endpoint: subJson.endpoint,
              p256dh: subJson.keys?.p256dh ?? "",
              auth: subJson.keys?.auth ?? "",
            }),
          });

          // Persist push_alerts: true immediately so DB stays in sync
          const { data: { user } } = await sb.auth.getUser();
          if (user) {
            await sb.from("users").update({
              notification_prefs: { ...prefs, push_alerts: true },
            }).eq("id", user.id);
          }
        } catch (err: unknown) {
          setPrefs((p) => ({ ...p, push_alerts: false }));
          setError(err instanceof Error ? err.message : "Failed to enable push notifications");
        }
      }
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your profile and notification preferences.</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Profile section */}
          <section className="bg-white rounded-xl border p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Profile</h2>
            <form onSubmit={saveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Email is managed through your Supabase auth account.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Phone <span className="text-gray-400">(for SMS alerts)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (312) 555-0100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {profileError && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{profileError}</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {profileSaving ? "Saving…" : "Save profile"}
                </button>
                {profileSaved && (
                  <span className="text-sm text-green-600 font-medium">Saved ✓</span>
                )}
              </div>
            </form>
          </section>

          {/* Notification preferences */}
          <section className="bg-white rounded-xl border p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Notifications</h2>
            <p className="text-xs text-gray-500 mb-5">
              Choose how you want to be alerted when a revenue leak is detected.
            </p>
            <form onSubmit={savePrefs} className="space-y-5">
              {/* Channel toggles */}
              <div className="space-y-3">
                {(
                  [
                    { key: "email_alerts",  label: "Email alerts",  desc: "Get an email for every detected leak" },
                    { key: "sms_alerts",    label: "SMS alerts",    desc: "Get a text message (requires phone number)" },
                    { key: "push_alerts",   label: "Push notifications", desc: "Browser/mobile push alerts (requires permission)" },
                    { key: "slack_alerts",  label: "Slack alerts",  desc: "Post to your connected Slack channel" },
                  ] as { key: keyof NotifPrefs; label: string; desc: string }[]
                ).map(({ key, label, desc }) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <div className="relative mt-0.5">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={prefs[key] as boolean}
                        onChange={() => toggle(key)}
                      />
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${
                          prefs[key] ? "bg-blue-600" : "bg-gray-200"
                        }`}
                      >
                        <div
                          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            prefs[key] ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-500">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Alert threshold */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  Alert threshold — only notify me when potential leak exceeds:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {THRESHOLD_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                        prefs.alert_threshold_cents === opt.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-700 hover:border-blue-300"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        checked={prefs.alert_threshold_cents === opt.value}
                        onChange={() => setPrefs((p) => ({ ...p, alert_threshold_cents: opt.value }))}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save preferences"}
                </button>
                {saved && (
                  <span className="text-sm text-green-600 font-medium">Saved ✓</span>
                )}
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

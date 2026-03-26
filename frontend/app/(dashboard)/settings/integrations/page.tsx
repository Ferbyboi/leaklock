"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

interface Integration {
  connected: boolean;
  merchant_id?: string;
  expires_at?: string;
  updated_at?: string;
}

const PROVIDER_META: Record<string, { name: string; description: string; icon: string }> = {
  square: {
    name: "Square",
    description: "POS orders, payments, and inventory sync",
    icon: "S",
  },
  toast: {
    name: "Toast POS",
    description: "Restaurant orders and check data",
    icon: "T",
  },
  servicetitan: {
    name: "ServiceTitan",
    description: "HVAC, plumbing, and electrical job data",
    icon: "ST",
  },
  housecallpro: {
    name: "HousecallPro",
    description: "Field service jobs and invoices",
    icon: "HC",
  },
  quickbooks: {
    name: "QuickBooks",
    description: "Accounting and invoice reconciliation",
    icon: "QB",
  },
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Record<string, Integration>>({});
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const justConnected = searchParams.get("connected");

  const sb = useMemo(() => createClient(), []);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    loadIntegrations();
  }, []);

  async function loadIntegrations() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;

      const resp = await fetch(`${apiUrl}/oauth/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error("Failed to load integrations");
      const data = await resp.json();
      setIntegrations(data.integrations || {});
    } catch (err: any) {
      setError(err?.message ?? "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  async function connectProvider(provider: string) {
    setConnectingProvider(provider);
    setError(null);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;

      const resp = await fetch(`${apiUrl}/oauth/${provider}/connect`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || "Failed to start connection");
      }
      const { authorize_url } = await resp.json();
      window.location.href = authorize_url;
    } catch (err: any) {
      setError(err?.message ?? "Connection failed");
      setConnectingProvider(null);
    }
  }

  async function disconnectProvider(provider: string) {
    if (!confirm(`Disconnect ${PROVIDER_META[provider]?.name ?? provider}? Webhook data will still be received but API calls will stop.`)) return;
    setError(null);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;

      await fetch(`${apiUrl}/oauth/${provider}/disconnect`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setIntegrations((prev) => ({
        ...prev,
        [provider]: { connected: false },
      }));
    } catch (err: any) {
      setError(err?.message ?? "Disconnect failed");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Connect your CRM or POS system to automatically sync jobs, invoices, and field data.
        </p>
      </div>

      {justConnected && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Successfully connected {PROVIDER_META[justConnected]?.name ?? justConnected}! Webhooks will now be processed automatically.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(PROVIDER_META).map(([provider, meta]) => {
            const integration = integrations[provider] || { connected: false };
            return (
              <div
                key={provider}
                className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                    {meta.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{meta.name}</h3>
                      {integration.connected && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                    {integration.connected && integration.merchant_id && (
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">
                        ID: {integration.merchant_id}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  {integration.connected ? (
                    <button
                      onClick={() => disconnectProvider(provider)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectProvider(provider)}
                      disabled={connectingProvider === provider}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      {connectingProvider === provider ? "Connecting..." : "Connect"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700">Webhook-only integrations</h3>
        <p className="text-xs text-gray-500 mt-1">
          If your CRM supports outgoing webhooks, you can point them directly at your LeakLock endpoint
          without OAuth. Configure your CRM to send job-complete events to:
        </p>
        <code className="block mt-2 text-xs bg-white border border-gray-200 rounded px-3 py-2 text-gray-700 font-mono break-all">
          {apiUrl}/webhooks/jobber/job-complete
        </code>
        <p className="text-xs text-gray-400 mt-1">
          Replace &quot;jobber&quot; with your CRM name (servicetitan, housecallpro, square, toast).
        </p>
      </div>
    </div>
  );
}

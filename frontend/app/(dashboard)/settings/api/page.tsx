"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const WEBHOOK_ENDPOINTS = [
  { label: "Generic",       method: "POST", path: "/webhooks/generic" },
  { label: "ServiceTitan",  method: "POST", path: "/webhooks/servicetitan" },
  { label: "Jobber",        method: "POST", path: "/webhooks/jobber" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-2 px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors shrink-0"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function ApiSettingsPage() {
  const sb = createClient();

  const [keys, setKeys]         = useState<ApiKey[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string>("");

  // Create key form
  const [newKeyName, setNewKeyName]     = useState("");
  const [generating, setGenerating]     = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);
  const [newKeyValue, setNewKeyValue]   = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

  const loadKeys = useCallback(async (tid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await sb
      .from("api_keys")
      .select("id, name, key_prefix, created_at, last_used_at")
      .eq("tenant_id", tid)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (err) {
      setError(err.message);
    } else {
      setKeys(data ?? []);
    }
    setLoading(false);
  }, [sb]);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const tid: string = user.user_metadata?.tenant_id ?? user.id;
      setTenantId(tid);
      await loadKeys(tid);
    }
    init();
  }, [sb, loadKeys]);

  async function revokeKey(id: string, name: string) {
    if (!window.confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;
    const { error: err } = await sb
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (err) {
      setError(err.message);
    } else {
      setKeys((prev) => prev.filter((k) => k.id !== id));
    }
  }

  async function generateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) {
      setGenError("Please enter a name for this key.");
      return;
    }

    setGenerating(true);
    setGenError(null);
    setNewKeyValue(null);

    const rawKey = `sk_live_${crypto.randomUUID().replace(/-/g, "")}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await hashKey(rawKey);

    const { error: err } = await sb
      .from("api_keys")
      .insert({
        name:       newKeyName.trim(),
        key_prefix: keyPrefix,
        key_hash:   keyHash,
        tenant_id:  tenantId,
      });

    if (err) {
      setGenError(err.message);
    } else {
      setNewKeyValue(rawKey);
      setNewKeyName("");
      await loadKeys(tenantId);
    }

    setGenerating(false);
  }

  return (
    <div className="max-w-3xl space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API Access</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage API keys for webhook integration and external access.
        </p>
      </div>

      {/* Your API Keys */}
      <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Your API Keys</h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-500">No API keys yet. Generate one below.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Key</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Last Used</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {keys.map((key) => (
                  <tr key={key.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-gray-900">{key.name}</td>
                    <td className="px-6 py-3">
                      <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                        {key.key_prefix}••••••••
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {key.last_used_at
                        ? new Date(key.last_used_at).toLocaleDateString()
                        : <span className="text-gray-400">Never</span>
                      }
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => revokeKey(key.id, key.name)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline transition-colors"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Newly generated key success box */}
      {newKeyValue && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-green-800 mb-2">
            Key generated — copy it now. It won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2">
            <code className="font-mono text-xs text-gray-800 flex-1 break-all">{newKeyValue}</code>
            <CopyButton text={newKeyValue} />
          </div>
          <p className="text-xs text-green-700 mt-2">
            Store this key in a secrets manager. LeakLock only stores the prefix for display.
          </p>
        </div>
      )}

      {/* Create new API key */}
      <section className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Create New API Key</h2>
        <p className="text-xs text-gray-500 mb-5">
          Give the key a descriptive name so you know which integration is using it.
        </p>
        <form onSubmit={generateKey} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Key name
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. ServiceTitan Production"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={generating}
            />
          </div>
          {genError && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{genError}</p>
          )}
          <button
            type="submit"
            disabled={generating || !newKeyName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? "Generating…" : "Generate Key"}
          </button>
        </form>
      </section>

      {/* Webhook endpoints */}
      <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Webhook Endpoints</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure your CRM or field-service software to POST job data to these URLs.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {WEBHOOK_ENDPOINTS.map((ep) => {
            const fullUrl = `${apiUrl}${ep.path}`;
            return (
              <div key={ep.path} className="flex items-center gap-3 px-6 py-4">
                <div className="shrink-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-600">
                    {ep.method}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-700 mb-0.5">{ep.label}</p>
                  <p className="font-mono text-xs text-gray-500 truncate">{fullUrl}</p>
                </div>
                <CopyButton text={fullUrl} />
              </div>
            );
          })}
        </div>
      </section>

      {/* Integration docs callout */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
        <div className="text-blue-500 mt-0.5 shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm text-blue-800">
          Need help integrating?{" "}
          <span className="font-medium">
            See the webhook setup guide in Settings &rarr; General.
          </span>
        </p>
      </div>

    </div>
  );
}

'use client';

import { useState, useRef } from 'react';

interface Gap {
  description: string;
  severity: 'critical' | 'warning' | 'info';
  rule?: string;
}

interface DiagnosticResult {
  gaps: Gap[];
  score: number;
  niche_detected: string;
  summary: string;
  cta_text: string;
  total_gaps: number;
  critical_count: number;
  warning_count: number;
}

const SEVERITY_STYLES = {
  critical: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  info: 'bg-blue-100 text-blue-700',
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 90 ? '#059669' : score >= 70 ? '#d97706' : '#dc2626';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" className="-rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute" style={{ marginTop: '28px' }}>
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
      </div>
      <p className="text-sm text-gray-500">Compliance Score</p>
    </div>
  );
}

export default function DiagnosticPage() {
  const [mode, setMode] = useState<'file' | 'text'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const formData = new FormData();
      if (mode === 'file' && file) {
        formData.append('file', file);
      } else if (mode === 'text' && text.trim()) {
        formData.append('text_input', text.trim());
      } else {
        setError('Please upload a file or paste your compliance records.');
        setLoading(false);
        return;
      }

      const res = await fetch(`${apiBase}/diagnostic/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (res.status === 429) {
        setError('Rate limit reached. You can analyze 3 documents per hour. Sign up for unlimited access.');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || 'Analysis failed. Please try again.');
        return;
      }

      const data: DiagnosticResult = await res.json();
      setResult(data);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError('');
    setText('');
    setFile(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-blue-700">LeakLock</span>
            <span className="text-gray-400 text-sm">Free Compliance Check</span>
          </div>
          <a
            href="/login"
            className="text-sm text-blue-700 hover:underline font-medium"
          >
            Sign in →
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Free Compliance Gap Analysis
          </h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Upload a photo of your service log or paste your records. We&apos;ll check for
            regulatory gaps and tell you what&apos;s missing — instantly, no sign-up required.
          </p>
          <p className="text-xs text-gray-400 mt-2">3 free analyses per hour · No data stored</p>
        </div>

        {!result ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            {/* Mode toggle */}
            <div className="flex gap-2 mb-5">
              <button
                type="button"
                onClick={() => setMode('text')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'text'
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Paste Text
              </button>
              <button
                type="button"
                onClick={() => setMode('file')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'file'
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Upload Image / PDF
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'text' ? (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    'Paste your service log or compliance records here.\n\nExample:\nDate: 3/25/2026\nChicken breast: 165°F ✓\nBeef patty: 152°F\nSanitizer bucket: 75ppm\nTech: Mike S.'
                  }
                  rows={8}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  {file ? (
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">{file.name}</span>
                      <span className="text-gray-400 ml-2">
                        ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                    </div>
                  ) : (
                    <>
                      <svg className="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-sm text-gray-600">
                        <span className="text-blue-700 font-medium">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-400 mt-1">PNG, JPG, PDF · Max 10MB</p>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-700 text-white rounded-xl font-semibold hover:bg-blue-800 disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Analyzing…
                  </span>
                ) : (
                  'Analyze My Records'
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Score card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start gap-6">
                <div className="relative flex flex-col items-center">
                  <ScoreRing score={result.score} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Niche detected
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                      {result.niche_detected}
                    </span>
                  </div>
                  <p className="text-gray-800 font-medium mb-2">{result.summary}</p>
                  <div className="flex gap-4 text-sm">
                    <span className="text-red-600 font-semibold">
                      {result.critical_count} critical
                    </span>
                    <span className="text-yellow-600 font-semibold">
                      {result.warning_count} warnings
                    </span>
                    <span className="text-blue-600 font-semibold">
                      {result.total_gaps - result.critical_count - result.warning_count} info
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Gaps */}
            {result.gaps.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="font-semibold text-gray-900 mb-4">Compliance Gaps Found</h2>
                <div className="space-y-3">
                  {result.gaps.map((gap, i) => (
                    <div
                      key={i}
                      className={`border rounded-xl p-4 ${SEVERITY_STYLES[gap.severity]}`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 mt-0.5 ${SEVERITY_BADGE[gap.severity]}`}
                        >
                          {gap.severity}
                        </span>
                        <p className="text-sm leading-relaxed">{gap.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="bg-blue-700 rounded-2xl p-6 text-white">
              <h3 className="font-bold text-lg mb-2">Fix these issues automatically</h3>
              <p className="text-blue-100 text-sm mb-4">{result.cta_text}</p>
              <a
                href="/signup"
                className="inline-block bg-white text-blue-700 font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-sm"
              >
                Start Free Trial →
              </a>
            </div>

            <button
              onClick={reset}
              className="w-full py-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Analyze another document
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

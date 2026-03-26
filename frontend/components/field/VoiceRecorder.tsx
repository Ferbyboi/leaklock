"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { createClient } from "@/lib/supabase";

type RecordingState = "idle" | "recording" | "stopped" | "uploading" | "done" | "error";

interface Props {
  jobId: string;
  locationId?: string;
  onComplete?: (fieldEventId: string) => void;
}

export function VoiceRecorder({ jobId, locationId, onComplete }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (wavesurferRef.current) wavesurferRef.current.destroy();
    };
  }, []);

  function drawLiveWaveform(analyser: AnalyserNode, canvas: HTMLCanvasElement) {
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx = ctxRaw;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "#f9fafb";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#2563eb";
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    draw();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up Web Audio API analyser for live waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start live canvas waveform drawing
      if (canvasRef.current) {
        drawLiveWaveform(analyser, canvasRef.current);
      }

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();
        // Stop live animation
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        loadPlaybackWaveform();
      };

      mediaRef.current = recorder;
      recorder.start(1000);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied");
      setState("error");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
    setState("stopped");
  }

  function loadPlaybackWaveform() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const blobUrl = URL.createObjectURL(blob);

    if (!waveformRef.current) return;

    // Destroy previous instance if any
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "#93c5fd",
      progressColor: "#2563eb",
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorColor: "#1d4ed8",
      normalize: true,
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    ws.load(blobUrl);
    wavesurferRef.current = ws;
  }

  function togglePlayback() {
    wavesurferRef.current?.playPause();
  }

  async function handleUpload() {
    setState("uploading");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const sb = createClient();

      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const path = `voice/${user.id}/${Date.now()}.webm`;
      const { error: uploadErr } = await sb.storage
        .from("field-media")
        .upload(path, blob, { contentType: "audio/webm" });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = sb.storage
        .from("field-media")
        .getPublicUrl(path);

      const { data: eventData, error: eventErr } = await sb
        .from("field_events")
        .insert({
          job_id: jobId,
          location_id: locationId ?? null,
          user_id: user.id,
          event_type: "voice",
          raw_storage_url: urlData.publicUrl,
          transcript: null,
          compliance_status: "pending",
        })
        .select("id")
        .single();

      if (eventErr) throw eventErr;

      // Trigger the process-voice edge function asynchronously
      const { error: fnErr } = await sb.functions.invoke("process-voice", {
        body: { field_event_id: eventData.id, audio_url: urlData.publicUrl },
      });
      if (fnErr) {
        console.error("process-voice edge function failed:", fnErr);
        // Don't block — the field_event is saved, transcription can be retried
      }

      // Clean up wavesurfer
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }

      setState("done");
      onComplete?.(eventData.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  }

  function resetRecorder() {
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    chunksRef.current = [];
    setSeconds(0);
    setIsPlaying(false);
    setError(null);
    setState("idle");
  }

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-3 p-4 rounded-xl border bg-card">
      <h3 className="text-sm font-medium">Voice Note</h3>

      {/* Live waveform canvas — visible during recording */}
      {state === "recording" && (
        <canvas
          ref={canvasRef}
          width={280}
          height={64}
          className="w-full rounded-lg border border-blue-100 bg-gray-50"
        />
      )}

      {/* WaveSurfer playback container — visible after recording stops */}
      {(state === "stopped" || state === "uploading") && (
        <div ref={waveformRef} className="w-full rounded-lg overflow-hidden" />
      )}

      {state === "idle" && (
        <button
          onClick={startRecording}
          className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md"
          aria-label="Start recording"
        >
          <MicIcon />
        </button>
      )}

      {state === "recording" && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={stopRecording}
            className="w-16 h-16 rounded-full bg-gray-800 hover:bg-gray-900 text-white flex items-center justify-center shadow-md animate-pulse"
            aria-label="Stop recording"
          >
            <StopIcon />
          </button>
          <span className="text-sm font-mono text-red-500">{fmt(seconds)}</span>
        </div>
      )}

      {state === "stopped" && (
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlayback}
              className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-sm"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="text-xs text-gray-500 font-mono">{fmt(seconds)} recorded</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Save &amp; Upload
            </button>
            <button
              onClick={resetRecorder}
              className="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Processing…
        </div>
      )}

      {state === "done" && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-green-600 text-sm font-medium">✓ Note saved</span>
          <button
            onClick={resetRecorder}
            className="text-xs text-gray-500 underline"
          >
            Record another
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-red-600 text-sm">{error}</span>
          <button
            onClick={resetRecorder}
            className="text-xs text-gray-500 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

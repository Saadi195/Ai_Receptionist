"use client";

import { useEffect, useImperativeHandle, forwardRef } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import Orb from "./Orb";
import type { OrbState } from "./Orb";

export interface VoiceOrbRef {
  start: () => void;
  pause: () => void;
}

interface VoiceOrbProps {
  sessionActive: boolean;
  orbState: OrbState;
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onUserSpeakingChange?: (speaking: boolean) => void;
}

const VoiceOrb = forwardRef<VoiceOrbRef, VoiceOrbProps>(function VoiceOrb(
  { sessionActive, orbState, onSpeechStart, onSpeechEnd, onUserSpeakingChange },
  ref
) {
  const vad = useMicVAD({
    startOnLoad: false, // do not activate until startSession()

    additionalAudioConstraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },

    onSpeechStart,
    onSpeechEnd,

    onVADMisfire: () => {
      console.log("VAD MISFIRE — speech too short, discarded");
    },

    // Static asset paths — files must exist in /public
    modelURL: "/silero_vad_v5.onnx",
    workletURL: "/vad.worklet.bundle.min.js",
    model: "v5",
    baseAssetPath: "/",
    onnxWASMBasePath: "/",
    ortConfig: (ort: any) => {
      ort.env.wasm.wasmPaths = "/";
      ort.env.wasm.numThreads = 1;
    },

    // Tuned for low-latency conversational turnarounds (< 2 seconds)
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.45, // ~0.15 lower than positive
    minSpeechMs: 150,
    preSpeechPadMs: 200,
    redemptionMs: 400,
  } as any);

  useImperativeHandle(
    ref,
    () => ({
      start: () => {
        try {
          vad.start();
        } catch (e) {
          console.warn("[VAD] start error:", e);
        }
      },
      pause: () => {
        try {
          if (!vad.errored && !vad.loading) {
            vad.pause();
          }
        } catch (e) {
          console.warn("[VAD] pause error:", e);
        }
      },
    }),
    [vad]
  );

  useEffect(() => {
    onUserSpeakingChange?.(vad.userSpeaking);
  }, [vad.userSpeaking, onUserSpeakingChange]);

  return (
    <div className="scale-75 md:scale-100 transition-transform">
      <Orb state={orbState} />
    </div>
  );
});

export default VoiceOrb;

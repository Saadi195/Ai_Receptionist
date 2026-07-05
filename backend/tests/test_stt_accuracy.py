"""
Phase 2 — STT Accuracy Test Script
Restaurant AI Ordering System

Tests three models against 30 audio samples.
Outputs accuracy results and a clear PROCEED / DO NOT PROCEED decision.

Usage:
    cd backend
    source venv/bin/activate
    python tests/test_stt_accuracy.py

Requirements in .env:
    DEEPGRAM_API_KEY
    GROQ_API_KEY
"""

import os
import sys
import json
import time
import httpx
from pathlib import Path
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SAMPLES_DIR = Path(__file__).parent / "audio_samples"
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

# ── GROUND TRUTH ─────────────────────────────────────────────────────────────
# Only menu item names are checked — filler words do not matter for order accuracy

GROUND_TRUTH = {
    "01": ["chicken karahi"],
    "02": ["beef burger"],
    "03": ["zeera rice", "naan"],
    "04": ["mutton karahi", "naan"],
    "05": ["chicken biryani"],
    "06": ["seekh kebab", "roti"],
    "07": ["mango shake"],
    "08": ["dal makhani"],
    "09": ["garlic naan"],
    "10": ["chicken burger", "pepsi"],
    "11": ["nihari", "roti"],
    "12": ["zeera rice"],
    "13": ["chicken biryani", "naan"],
    "14": ["mutton karahi"],
    "15": ["mango shake"],
}

# Menu keyterms — passed to Deepgram as keyterm prompting
# Verified: keyterm parameter (singular) is correct for Nova-3 (Deepgram docs, July 2026)
# Do not use "keyterms" (plural) — that is wrong
MENU_KEYTERMS = [
    "Chicken Karahi", "Mutton Karahi", "Beef Burger", "Chicken Burger",
    "Zeera Rice", "Chicken Biryani", "Seekh Kebab", "Mango Shake",
    "Dal Makhani", "Garlic Naan", "Nihari", "Naan", "Roti", "Pepsi",
]

# Groq prompt for name context (max 224 tokens)
GROQ_PROMPT = (
    "Restaurant order. Menu items: Chicken Karahi, Mutton Karahi, "
    "Beef Burger, Chicken Burger, Zeera Rice, Chicken Biryani, "
    "Seekh Kebab, Mango Shake, Dal Makhani, Garlic Naan, Nihari, "
    "Naan, Roti, Pepsi. Language: Urdu-English mixed."
)


def check_accuracy(transcript: str, sample_num: str) -> tuple[bool, list, list]:
    t = transcript.lower()
    required = GROUND_TRUTH.get(sample_num, [])
    found = [term for term in required if term.lower() in t]
    missing = [term for term in required if term.lower() not in t]
    return len(missing) == 0, found, missing


# ── MODEL 1: GROQ WHISPER LARGE V3 TURBO (free tier) ─────────────────────────

def transcribe_groq(audio_path: Path) -> tuple[str, float]:
    """
    Groq Whisper Large v3 Turbo — free tier, no credit card.
    Rate limit: 2,000 requests/day, 7,200 audio seconds/hour.
    Sleep 2s between calls to respect 30 RPM limit.
    Max file size: 25 MB on free tier.
    """
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    start = time.time()
    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files={"file": (audio_path.name, audio_bytes, "audio/wav")},
            data={
                "model": "whisper-large-v3-turbo",
                "language": "ur",
                "response_format": "json",
                "prompt": GROQ_PROMPT,
            },
            timeout=30.0,
        )
        latency = time.time() - start

        if response.status_code == 429:
            print("    [RATE LIMIT] Groq — waiting 60s...")
            time.sleep(60)
            return transcribe_groq(audio_path)

        if response.status_code != 200:
            return f"[ERROR {response.status_code}]", time.time() - start

        return response.json().get("text", ""), latency

    except Exception as e:
        return f"[EXCEPTION: {e}]", time.time() - start
    finally:
        time.sleep(2)  # Respect free tier rate limit


# ── MODEL 2: DEEPGRAM NOVA-3 MULTILINGUAL (keyterm prompting) ─────────────────

def transcribe_deepgram_multi(audio_path: Path) -> tuple[str, float]:
    """
    Deepgram Nova-3 Multilingual — $200 free credit on signup.
    language=multi enables Urdu-English code-switching.
    keyterm (singular) parameter — verified from Deepgram docs July 2026.
    Supports up to 100 keyterms per request.
    """
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    params = [
        ("model", "nova-3"),
        ("language", "multi"),
        ("smart_format", "true"),
        ("punctuate", "true"),
    ] + [("keyterm", term) for term in MENU_KEYTERMS]

    start = time.time()
    try:
        response = httpx.post(
            "https://api.deepgram.com/v1/listen",
            headers={
                "Authorization": f"Token {DEEPGRAM_API_KEY}",
                "Content-Type": "audio/wav",
            },
            params=params,
            content=audio_bytes,
            timeout=30.0,
        )
        latency = time.time() - start

        if response.status_code != 200:
            return f"[ERROR {response.status_code}: {response.text[:100]}]", latency

        data = response.json()
        transcript = (
            data.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("transcript", "[EMPTY]")
        )
        return transcript, latency

    except Exception as e:
        return f"[EXCEPTION: {e}]", time.time() - start


# ── MODEL 3: DEEPGRAM NOVA-3 URDU MONOLINGUAL ────────────────────────────────

def transcribe_deepgram_urdu(audio_path: Path) -> tuple[str, float]:
    """
    Deepgram Nova-3 Urdu monolingual — added February 2026.
    Better for pure Urdu speech.
    May miss English menu item names — compare results against nova-3 multi.
    """
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    params = [
        ("model", "nova-3"),
        ("language", "ur"),
        ("smart_format", "true"),
        ("punctuate", "true"),
    ] + [("keyterm", term) for term in MENU_KEYTERMS]

    start = time.time()
    try:
        response = httpx.post(
            "https://api.deepgram.com/v1/listen",
            headers={
                "Authorization": f"Token {DEEPGRAM_API_KEY}",
                "Content-Type": "audio/wav",
            },
            params=params,
            content=audio_bytes,
            timeout=30.0,
        )
        latency = time.time() - start

        if response.status_code != 200:
            return f"[ERROR {response.status_code}: {response.text[:100]}]", latency

        data = response.json()
        transcript = (
            data.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("transcript", "[EMPTY]")
        )
        return transcript, latency

    except Exception as e:
        return f"[EXCEPTION: {e}]", time.time() - start


# ── NOISE REDUCTION PREPROCESSOR ─────────────────────────────────────────────

def denoise(audio_path: Path) -> Path:
    """
    Applies noise reduction to audio before STT.
    Only used if noisy condition accuracy is below 70%.
    Returns path to denoised temp file.
    """
    import noisereduce as nr
    import soundfile as sf
    import numpy as np

    data, rate = sf.read(audio_path)
    reduced = nr.reduce_noise(y=data, sr=rate, prop_decrease=0.8)
    out_path = audio_path.parent / f"denoised_{audio_path.name}"
    sf.write(out_path, reduced.astype(np.float32), rate)
    return out_path


# ── TEST RUNNER ───────────────────────────────────────────────────────────────

def run_tests(apply_denoise: bool = False) -> list[dict]:
    results = []

    models = {
        "groq_whisper_turbo": transcribe_groq,
        "deepgram_nova3_multi": transcribe_deepgram_multi,
        "deepgram_nova3_urdu": transcribe_deepgram_urdu,
    }

    for condition in ["quiet", "noisy"]:
        print(f"\n{'='*60}\nCONDITION: {condition.upper()}\n{'='*60}")

        for i in range(1, 16):
            sample_num = f"{i:02d}"
            filename = f"{condition}_{sample_num}.wav"
            audio_path = SAMPLES_DIR / filename

            if not audio_path.exists():
                print(f"  MISSING: {filename} — skipping")
                continue

            if apply_denoise and condition == "noisy":
                audio_path = denoise(audio_path)

            print(f"\n[{sample_num}] Expected: {GROUND_TRUTH.get(sample_num, [])}")

            for model_name, fn in models.items():
                transcript, latency = fn(audio_path)
                passed, found, missing = check_accuracy(transcript, sample_num)

                results.append({
                    "condition": condition,
                    "sample": sample_num,
                    "model": model_name,
                    "transcript": transcript,
                    "passed": passed,
                    "found_terms": found,
                    "missing_terms": missing,
                    "latency_ms": round(latency * 1000),
                    "denoised": apply_denoise and condition == "noisy",
                })

                status = "PASS" if passed else "FAIL"
                print(f"  [{status}] {model_name} {latency*1000:.0f}ms")
                if not passed:
                    print(f"    Missing: {missing}")
                    print(f"    Got: {transcript[:80]}")

    return results


def print_decision(results: list[dict]):
    print(f"\n{'='*60}\nRESULTS SUMMARY\n{'='*60}\n")

    model_scores = {}
    for model in ["groq_whisper_turbo", "deepgram_nova3_multi", "deepgram_nova3_urdu"]:
        scores = {}
        for condition in ["quiet", "noisy"]:
            subset = [r for r in results if r["model"] == model and r["condition"] == condition]
            if not subset:
                scores[condition] = None
                continue
            pct = sum(1 for r in subset if r["passed"]) / len(subset) * 100
            avg_ms = sum(r["latency_ms"] for r in subset) / len(subset)
            scores[condition] = {"pct": pct, "avg_ms": avg_ms, "n": len(subset)}
            print(f"{model} | {condition:5s} | {pct:.0f}% ({sum(1 for r in subset if r['passed'])}/{len(subset)}) | {avg_ms:.0f}ms avg")
        model_scores[model] = scores

    print(f"\n{'='*60}\nDECISION\n{'='*60}\n")
    print("Threshold: 85% on BOTH quiet AND noisy conditions to proceed.\n")

    winners = []
    for model, scores in model_scores.items():
        q = scores.get("quiet")
        n = scores.get("noisy")
        if q and n and q["pct"] >= 85 and n["pct"] >= 85:
            winners.append((model, q["pct"], n["pct"]))

    if winners:
        best = sorted(winners, key=lambda x: x[1] + x[2], reverse=True)[0]
        print(f"PROCEED TO PHASE 3")
        print(f"Use model: {best[0]}")
        print(f"Quiet: {best[1]:.0f}% | Noisy: {best[2]:.0f}%")
        print(f"\nUpdate backend/.env:")
        print(f'STT_MODEL_WINNER="{best[0]}"')
    else:
        print("DO NOT PROCEED TO PHASE 3")
        print("\nNo model reached 85% on both conditions.")
        print("See FAILURE_HANDLING section in Phase 2 plan.")
        print("\nRun with noise reduction:")
        print("  python tests/test_stt_accuracy.py --denoise")


def save_results(results: list[dict]):
    path = RESULTS_DIR / "stt_accuracy_results.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nResults saved to: {path}")


if __name__ == "__main__":
    import sys

    if not DEEPGRAM_API_KEY:
        raise SystemExit("ERROR: DEEPGRAM_API_KEY not set in backend/.env")
    if not GROQ_API_KEY:
        raise SystemExit("ERROR: GROQ_API_KEY not set in backend/.env")

    wav_count = len(list(SAMPLES_DIR.glob("*.wav")))
    if wav_count < 30:
        raise SystemExit(
            f"ERROR: Found {wav_count}/30 audio samples in {SAMPLES_DIR}\n"
            "Follow instructions in backend/tests/RECORD_AUDIO_SAMPLES.md first."
        )

    apply_denoise = "--denoise" in sys.argv
    if apply_denoise:
        print("Running WITH noise reduction preprocessing")

    print(f"Starting STT accuracy test — {wav_count} samples found\n")
    results = run_tests(apply_denoise=apply_denoise)
    print_decision(results)
    save_results(results)

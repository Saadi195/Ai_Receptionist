import os
import sys
import httpx
from dotenv import load_dotenv

# Load .env from parent directory or current environment
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))
load_dotenv()

def verify_deepgram():
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        print("[ERROR] DEEPGRAM_API_KEY is not set.")
        return False

    test_wav_path = os.path.join(os.path.dirname(__file__), "audio_samples", "quiet_01.wav")
    if not os.path.exists(test_wav_path):
        print(f"[ERROR] Audio file not found at {test_wav_path}")
        return False

    with open(test_wav_path, "rb") as f:
        audio = f.read()

    print(f"[DEEPGRAM] Sending {len(audio)} bytes from quiet_01.wav to Deepgram API (model=nova-3, language=en)...")
    try:
        resp = httpx.post(
            "https://api.deepgram.com/v1/listen?model=nova-3&language=en",
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "audio/wav",
            },
            content=audio,
            timeout=30,
        )
        print("Status:", resp.status_code)
        if resp.status_code != 200:
            print("[ERROR Response]:", resp.text)
            return False
        data = resp.json()
        transcript = data["results"]["channels"][0]["alternatives"][0]["transcript"]
        print("Transcript:", transcript)
        return True
    except Exception as e:
        print(f"[ERROR] Deepgram request failed: {e}")
        return False

if __name__ == "__main__":
    verify_deepgram()

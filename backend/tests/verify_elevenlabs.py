import os
import sys
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

# Add parent directory to sys.path to import tts_service
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tts_service import generate_speech

load_dotenv(override=True)

def check_voices_and_test():
    api_key = os.getenv("ELEVENLABS_API_KEY")
    print(f"[API KEY] Using key ending in: ...{api_key[-4:] if api_key else 'NONE'}")
    
    client = ElevenLabs(api_key=api_key)
    
    print("\n[VOICES] Fetching available voices from ElevenLabs account...")
    try:
        response = client.voices.get_all()
        voices = response.voices
        print(f"Found {len(voices)} voices:")
        for v in voices:
            labels = v.labels or {}
            accent = labels.get("accent", "")
            desc = labels.get("description", "")
            use_case = labels.get("use_case", "")
            print(f" - ID: {v.voice_id} | Name: {v.name} | Accent/Labels: {accent} {desc} {use_case}")
    except Exception as e:
        print(f"[ERROR] Could not list voices: {e}")

    print("\n[TESTing TTS GENERATION] Testing generate_speech() with eleven_multilingual_v2...")
    test_text = "Assalam-o-Alaikum! Welcome to our restaurant. Aap kya khana pasand karenge? We have Chicken Karahi and Biryani today."
    audio = generate_speech(test_text)
    if audio and len(audio) > 0:
        print(f"[SUCCESS] Generated {len(audio)} bytes of audio successfully with multilingual model!")
        return True
    else:
        print("[FAILURE] Failed to generate speech.")
        return False

if __name__ == "__main__":
    check_voices_and_test()

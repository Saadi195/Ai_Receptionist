import os
import sys
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

# Add parent directory to sys.path to import tts_service
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tts_service import generate_speech

load_dotenv()

def verify_elevenlabs():
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("[ERROR] ELEVENLABS_API_KEY is not set.")
        return False

    client = ElevenLabs(api_key=api_key)
    try:
        sub = client.user.get_subscription()
        char_count = getattr(sub, "character_count", 0)
        char_limit = getattr(sub, "character_limit", 0)
        remaining = char_limit - char_count
        print(f"[ELEVENLABS SUBSCRIPTION] Character Count: {char_count}")
        print(f"[ELEVENLABS SUBSCRIPTION] Character Limit: {char_limit}")
        print(f"[ELEVENLABS SUBSCRIPTION] Remaining Characters: {remaining}")
        
        if remaining <= 0 and char_limit > 0:
            print("[WARNING] ElevenLabs character limit reached or zero characters remaining!")
            return False
    except Exception as e:
        print(f"[WARNING] Could not fetch subscription details: {e}")

    print("\n[TESTing TTS GENERATION] Testing generate_speech()...")
    test_text = "Hello! Welcome to our restaurant."
    audio = generate_speech(test_text)
    if audio and len(audio) > 0:
        print(f"[SUCCESS] Generated {len(audio)} bytes of audio successfully from ElevenLabs!")
        return True
    else:
        print("[FAILURE] Failed to generate speech from ElevenLabs.")
        return False

if __name__ == "__main__":
    verify_elevenlabs()

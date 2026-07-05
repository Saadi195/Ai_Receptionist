import os
from typing import Optional
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs.play import play

load_dotenv()

# Track free tier usage (10,000 chars/month limit)
_total_char_count = 0


def generate_speech(text: str) -> Optional[bytes]:
    global _total_char_count
    if not text or not text.strip():
        return None

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("[ERROR] ELEVENLABS_API_KEY not set in environment.")
        return None

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    model_id = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")

    try:
        client = ElevenLabs(api_key=api_key)

        char_len = len(text)
        _total_char_count += char_len
        print(
            f"[TTS USAGE] Generating speech for {char_len} chars | Session Total: {_total_char_count}/10000 chars"
        )

        audio_generator = client.text_to_speech.convert(
            voice_id=voice_id,
            model_id=model_id,
            text=text,
            output_format="mp3_44100_128",
        )

        audio_bytes = b"".join(audio_generator)
        return audio_bytes

    except Exception as e:
        print(f"[ERROR] ElevenLabs TTS API error: {e}")
        return None

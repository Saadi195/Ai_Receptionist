import os
from typing import Optional
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs.play import play

load_dotenv(override=True)

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

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
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
        err_str = str(e)
        if "quota_exceeded" in err_str or "exceeds your quota" in err_str:
            print("[ELEVENLABS QUOTA EXCEEDED] Your monthly quota of 10,000 characters is exhausted! Please update ELEVENLABS_API_KEY in backend/.env with a new API key.", flush=True)
        else:
            print(f"[ERROR] ElevenLabs TTS API error: {e}", flush=True)
        return None


def generate_speech_stream(text: str):
    """
    Returns a generator of audio bytes chunks.
    First chunk arrives ~200ms faster than waiting for full audio.
    Use this instead of generate_speech() for real-time responses.
    """
    global _total_char_count
    if not text or not text.strip():
        return
    try:
        load_dotenv(override=True)
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            print("[ERROR] ELEVENLABS_API_KEY not set in environment.", flush=True)
            return
        stream_client = ElevenLabs(api_key=api_key)

        char_len = len(text)
        _total_char_count += char_len
        print(
            f"[TTS USAGE] Generating speech stream for {char_len} chars | Session Total: {_total_char_count}/10000 chars"
        )
        audio_stream = stream_client.text_to_speech.convert(
            voice_id=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
            text=text,
            model_id=os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
            output_format="mp3_44100_128",
        )
        for chunk in audio_stream:
            if chunk:
                yield chunk
    except Exception as e:
        err_str = str(e)
        if "quota_exceeded" in err_str or "exceeds your quota" in err_str:
            print("[ELEVENLABS QUOTA EXCEEDED] Your monthly quota of 10,000 characters is exhausted! Please update ELEVENLABS_API_KEY in backend/.env with a new API key.", flush=True)
        else:
            print(f"[TTS STREAM ERROR] {e}", flush=True)
        return


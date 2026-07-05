"""
Restaurant AI Ordering API — Phase 3
FastAPI backend with Deepgram SDK 7.2.0 WebSocket streaming, Groq LLM, ElevenLabs TTS
"""

import os
import asyncio
import json
import threading
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from deepgram import DeepgramClient
from deepgram.listen.v2.types import ListenV2TurnInfo

from conversation_manager import ConversationManager
from tts_service import generate_speech
from database.supabase_client import get_supabase

load_dotenv()

app = FastAPI(
    title="Restaurant AI Ordering API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Deepgram model mapping ────────────────────────────────────────────────────
# SDK 7.2.0 uses "flux-general-multi" for multilingual (including Urdu-English)
# STT_MODEL_WINNER from .env is mapped here.
_DG_MODEL_MAP = {
    "nova-3": "flux-general-multi",
    "nova-2": "flux-general-en",
    "nova-3-multi": "flux-general-multi",
    "deepgram_nova3_multi": "flux-general-multi",
    "flux-general-multi": "flux-general-multi",
    "flux-general-en": "flux-general-en",
}


def _resolve_dg_model() -> str:
    raw = os.getenv("STT_MODEL_WINNER", "nova-3")
    return _DG_MODEL_MAP.get(raw, "flux-general-multi")


# ─── REST: Order creation ──────────────────────────────────────────────────────
class CreateOrderRequest(BaseModel):
    items: List[Dict[str, Any]]
    total_amount: int
    status: str = "pending"
    session_id: str


@app.get("/")
def read_root():
    return {"status": "success", "message": "Restaurant AI Ordering API is running"}


@app.get("/health")
def health_check():
    return {"status": "success"}


@app.post("/api/orders")
def create_order(order: CreateOrderRequest):
    try:
        db = get_supabase()
        result = db.table("orders").insert({
            "items": order.items,
            "total_amount": order.total_amount,
            "status": order.status,
            "session_id": order.session_id,
        }).execute()
        return {"status": "success", "data": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── WebSocket: Voice streaming ────────────────────────────────────────────────
@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """
    Browser connects via WebSocket.
    Browser sends raw audio bytes (webm/opus from MediaRecorder).
    Backend streams to Deepgram v2, receives EndOfTurn transcript,
    passes to ConversationManager, sends TTS audio + state JSON back.
    """
    await websocket.accept()
    loop = asyncio.get_running_loop()
    transcript_queue: asyncio.Queue[str] = asyncio.Queue()

    # One ConversationManager per WebSocket session
    conv_manager = ConversationManager()

    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        await websocket.close(code=1011, reason="DEEPGRAM_API_KEY missing")
        return

    dg_client = DeepgramClient(api_key=api_key)
    dg_model = _resolve_dg_model()

    # ── Deepgram connection (runs in a background thread) ──────────────────────
    # We use threading + asyncio queue to bridge sync Deepgram SDK → async FastAPI
    dg_socket = None
    dg_thread = None
    stop_event = threading.Event()

    audio_buffer: List[bytes] = []
    audio_lock = threading.Lock()

    def deepgram_thread_fn():
        """Runs in a background thread. Opens Deepgram v2 WebSocket and iterates."""
        nonlocal dg_socket
        try:
            with dg_client.listen.v2.connect(
                model=dg_model,
                encoding="opus",
                sample_rate=48000,
                keyterm=[
                    "Chicken Karahi", "Mutton Karahi", "Beef Burger", "Chicken Burger",
                    "Zeera Rice", "Chicken Biryani", "Seekh Kebab", "Mango Shake",
                    "Dal Makhani", "Garlic Naan", "Nihari", "Naan", "Roti", "Pepsi"
                ],
            ) as socket:
                dg_socket = socket
                for message in socket:
                    if stop_event.is_set():
                        break
                    # Send buffered audio
                    with audio_lock:
                        for chunk in audio_buffer:
                            socket.send_media(chunk)
                        audio_buffer.clear()

                    # Process incoming transcription messages
                    if isinstance(message, ListenV2TurnInfo):
                        event_type = message.event
                        # "EndOfTurn" means a complete utterance is ready
                        if hasattr(event_type, 'value'):
                            is_end = event_type.value in ("EndOfTurn", "EagerEndOfTurn")
                        else:
                            is_end = str(event_type) in ("EndOfTurn", "EagerEndOfTurn")

                        if is_end and message.transcript and message.transcript.strip():
                            transcript = message.transcript.strip()
                            print(f"[TURN END TRANSCRIPT]: {transcript}")
                            loop.call_soon_threadsafe(transcript_queue.put_nowait, transcript)

        except Exception as e:
            if not stop_event.is_set():
                print(f"[ERROR Deepgram thread]: {e}")

    dg_thread = threading.Thread(target=deepgram_thread_fn, daemon=True)
    dg_thread.start()

    async def receive_from_browser():
        """Receives audio bytes from browser WebSocket and buffers them for Deepgram."""
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    chunk = message["bytes"]
                    with audio_lock:
                        audio_buffer.append(chunk)
                    # Also send immediately to Deepgram if socket is ready
                    if dg_socket is not None:
                        try:
                            dg_socket.send_media(chunk)
                            with audio_lock:
                                audio_buffer.clear()
                        except Exception as e:
                            print(f"[Deepgram send error]: {e}")
                elif message.get("type") == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[WebSocket receive error]: {e}")

    async def process_transcripts_and_respond():
        """Takes completed utterances from queue, runs LLM, sends TTS audio back."""
        try:
            while True:
                sentence = await transcript_queue.get()
                print(f"[PROCESSING TRANSCRIPT]: {sentence}")

                # Run blocking LLM call in thread pool
                response_dict = await asyncio.to_thread(conv_manager.process_input, sentence)

                # Send state update JSON to browser
                state_msg = {
                    "type": "state_update",
                    "state": response_dict.get("state", "SLEEPING"),
                    "current_order": response_dict.get("current_order", []),
                    "order_total": response_dict.get("order_total", 0),
                    "response_text": response_dict.get("response_text", ""),
                }
                try:
                    await websocket.send_json(state_msg)
                except Exception:
                    break

                # Generate and send TTS audio
                resp_text = response_dict.get("response_text", "")
                if resp_text and resp_text.strip():
                    audio_bytes = await asyncio.to_thread(generate_speech, resp_text)
                    if audio_bytes:
                        try:
                            await websocket.send_bytes(audio_bytes)
                        except Exception:
                            break

                transcript_queue.task_done()

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Transcript processing error]: {e}")

    t1 = asyncio.create_task(receive_from_browser())
    t2 = asyncio.create_task(process_transcripts_and_respond())

    try:
        done, pending = await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    finally:
        stop_event.set()
        if dg_socket:
            try:
                dg_socket.send_close_stream()
            except Exception:
                pass
        print("[WebSocket] Session ended, Deepgram thread stopping")

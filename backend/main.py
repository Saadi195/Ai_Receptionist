"""
Restaurant AI Ordering API — Phase 4
FastAPI backend with Deepgram SDK 7.2.0, VAD audio (linear16/16000Hz),
interruption handling, dual EndOfTurn/EagerEndOfTurn turn detection.
"""

import os
import asyncio
import json
import threading
import time as _time
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
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Deepgram model mapping ────────────────────────────────────────────────────
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
    Phase 4 WebSocket handler.

    Audio flow:
    - Browser VAD captures speech segments as Float32Array @ 16000Hz
    - Frontend converts to Int16Array and sends as raw bytes over WS
    - Backend streams to Deepgram (encoding=linear16, sample_rate=16000)
    - Deepgram returns ListenV2TurnInfo messages
    - EndOfTurn  → process immediately (primary trigger)
    - EagerEndOfTurn → process only if EndOfTurn hasn't fired within 800ms (fallback)

    Interruption flow:
    - Frontend VAD onSpeechStart fires while AI is speaking
    - Frontend sends {"type": "interruption"} JSON over WS
    - Backend receives it in receive_from_browser(), sets interrupt_flag
    - process_transcripts_and_respond() checks flag before sending TTS bytes
    - Any in-progress TTS generation is discarded; state resets to listening
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

    # ── Per-session state ──────────────────────────────────────────────────────
    stop_event = threading.Event()
    interrupt_flag = asyncio.Event()       # Set when frontend sends interruption
    dg_socket = None
    audio_buffer: List[bytes] = []
    audio_lock = threading.Lock()

    # Turn detection guard: prevents EagerEndOfTurn from double-processing
    # when EndOfTurn fires very shortly after.
    last_end_of_turn_time: float = 0.0    # monotonic time
    EAGER_GUARD_SECS: float = 0.8         # 800ms — skip EagerEndOfTurn if EndOfTurn fired recently

    def deepgram_thread_fn():
        """
        Runs in a background thread.
        Opens Deepgram v2 WebSocket (linear16/16000Hz — VAD output format).
        Forwards audio chunks, receives TurnInfo messages, puts final transcripts in queue.
        """
        nonlocal dg_socket, last_end_of_turn_time
        try:
            with dg_client.listen.v2.connect(
                model=dg_model,
                # Phase 4: VAD output is Int16 PCM at 16000Hz
                encoding="linear16",
                sample_rate=16000,
                keyterm=[
                    "Chicken Karahi", "Mutton Karahi", "Beef Burger", "Chicken Burger",
                    "Zeera Rice", "Chicken Biryani", "Seekh Kebab", "Mango Shake",
                    "Dal Makhani", "Garlic Naan", "Nihari", "Naan", "Roti", "Pepsi",
                ],
            ) as socket:
                dg_socket = socket

                for message in socket:
                    if stop_event.is_set():
                        break

                    # Flush any buffered audio first
                    with audio_lock:
                        for chunk in audio_buffer:
                            socket.send_media(chunk)
                        audio_buffer.clear()

                    if not isinstance(message, ListenV2TurnInfo):
                        continue

                    transcript = (message.transcript or "").strip()
                    if not transcript:
                        continue

                    # Determine event type (handles both string and enum)
                    event_val = (
                        message.event.value
                        if hasattr(message.event, "value")
                        else str(message.event)
                    )

                    now = _time.monotonic()

                    if event_val == "EndOfTurn":
                        # Primary trigger — process always
                        last_end_of_turn_time = now
                        print(f"[EndOfTurn]: {transcript}")
                        loop.call_soon_threadsafe(transcript_queue.put_nowait, transcript)

                    elif event_val == "EagerEndOfTurn":
                        # Fallback — only fire if EndOfTurn hasn't recently processed this utterance
                        elapsed = now - last_end_of_turn_time
                        if elapsed > EAGER_GUARD_SECS:
                            print(f"[EagerEndOfTurn fallback]: {transcript}")
                            loop.call_soon_threadsafe(transcript_queue.put_nowait, transcript)
                        else:
                            print(f"[EagerEndOfTurn suppressed — EndOfTurn fired {elapsed*1000:.0f}ms ago]")

        except Exception as e:
            if not stop_event.is_set():
                print(f"[ERROR Deepgram thread]: {e}")

    dg_thread = threading.Thread(target=deepgram_thread_fn, daemon=True)
    dg_thread.start()

    async def receive_from_browser():
        """
        Receives messages from the browser WebSocket.
        - bytes  → audio from VAD (Int16 PCM, 16000Hz) → forward to Deepgram
        - text   → JSON control messages (interruption signal)
        """
        nonlocal last_end_of_turn_time
        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    chunk = message["bytes"]
                    # Forward immediately if socket is ready, else buffer
                    if dg_socket is not None:
                        try:
                            dg_socket.send_media(chunk)
                        except Exception as e:
                            print(f"[Deepgram send error]: {e}")
                            with audio_lock:
                                audio_buffer.append(chunk)
                    else:
                        with audio_lock:
                            audio_buffer.append(chunk)

                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type", "")

                        if msg_type == "interruption":
                            # Customer started speaking while AI was talking
                            print("[INTERRUPTION] Frontend interrupted AI speech")
                            interrupt_flag.set()           # Signal TTS sender to stop
                            # Reset turn detection guard so next utterance is fresh
                            last_end_of_turn_time = 0.0

                    except json.JSONDecodeError:
                        pass

                elif message.get("type") == "websocket.disconnect":
                    break

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[WebSocket receive error]: {e}")

    async def process_transcripts_and_respond():
        """
        Consumes completed utterances from queue.
        Runs LLM, sends state update JSON, sends TTS audio.
        Respects interrupt_flag — discards TTS if interrupted mid-stream.
        """
        try:
            while True:
                sentence = await transcript_queue.get()
                print(f"[PROCESSING]: {sentence}")

                # Clear any pending interrupt before processing new utterance
                interrupt_flag.clear()

                # Send interim transcript display to frontend
                try:
                    await websocket.send_json({"type": "transcript", "text": sentence})
                except Exception:
                    break

                # Run blocking LLM call in thread pool
                response_dict = await asyncio.to_thread(conv_manager.process_input, sentence)

                # Check if interrupted while LLM was thinking
                if interrupt_flag.is_set():
                    print("[INTERRUPTION] Discarding LLM response — customer spoke again")
                    transcript_queue.task_done()
                    continue

                # Send state update to browser
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

                # Generate TTS audio
                resp_text = response_dict.get("response_text", "")
                if resp_text and resp_text.strip() and not interrupt_flag.is_set():
                    audio_bytes = await asyncio.to_thread(generate_speech, resp_text)

                    # Final interrupt check before sending audio bytes
                    if audio_bytes and not interrupt_flag.is_set():
                        try:
                            await websocket.send_bytes(audio_bytes)
                        except Exception:
                            break
                    elif interrupt_flag.is_set():
                        print("[INTERRUPTION] TTS audio discarded — customer interrupted")

                transcript_queue.task_done()

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Transcript processing error]: {e}")

    async def send_initial_greeting():
        greeting_text = "Assalam-o-Alaikum! Main Savour Foods ka AI receptionist hoon. Main aapki kaise madad kar sakta hoon?"
        conv_manager.state = "TAKING_ORDER"
        conv_manager.history.append({"role": "assistant", "content": greeting_text})
        try:
            await websocket.send_json({
                "type": "state_update",
                "state": conv_manager.state,
                "current_order": [],
                "order_total": 0,
                "response_text": greeting_text,
            })
            audio_bytes = await asyncio.to_thread(generate_speech, greeting_text)
            if audio_bytes and not interrupt_flag.is_set():
                await websocket.send_bytes(audio_bytes)
        except Exception as e:
            print(f"[Initial greeting error]: {e}")

    asyncio.create_task(send_initial_greeting())
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

"""
Restaurant AI Ordering API — Phase 4
FastAPI backend with Deepgram SDK 7.2.0, VAD audio (linear16/16000Hz),
interruption handling, dual EndOfTurn/EagerEndOfTurn turn detection.
"""

import sys
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import asyncio
import json
import threading
import time as _time
import random
import string
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from deepgram import DeepgramClient

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

# ─── Deepgram model resolution ─────────────────────────────────────────────────
def _resolve_dg_model() -> str:
    return os.getenv("STT_MODEL_WINNER", "nova-3")


def generate_session_id() -> str:
    date_part = datetime.now().strftime("%Y%m%d-%H%M")
    rand_part = "".join(random.choices(
        string.ascii_uppercase + string.digits, k=4
    ))
    return f"{date_part}-{rand_part}"


def calc_line_total(unit_price: int, qty: str) -> int:
    try:
        q = str(qty).lower().replace("kg", "").strip()
        return round(unit_price * float(q)) if float(q) > 0 else unit_price
    except (ValueError, TypeError):
        return unit_price


def commit_order(
    order: list, 
    total: int, 
    session_id: str,
    db_client
) -> tuple[str, int]:
    """
    Writes confirmed order to Supabase.
    Returns order UUID on success.
    Raises Exception on failure — caller handles recovery.
    Never commits partial orders.
    """
    cleaned_order = []
    recalc_total = 0
    for item in order:
        unit_price = item.get("unit_price", item.get("price", 0))
        qty = str(item.get("quantity", item.get("qty", "1")))
        line_total = calc_line_total(unit_price, qty)
        recalc_total += line_total
        cleaned_order.append({
            "canonical_name": item.get("canonical_name", item.get("name", "Item")),
            "quantity": qty,
            "unit_price": unit_price,
            "line_total": line_total,
        })
    
    result = db_client.table("orders").insert({
        "items": cleaned_order,
        "total_amount": recalc_total,
        "status": "pending",
        "session_id": session_id,
    }).execute()
    
    if not result.data:
        raise Exception(f"Supabase insert returned empty data for session {session_id}")
    
    order_id = result.data[0]["id"]
    print(f"[ORDER COMMITTED] id={order_id} total=PKR {recalc_total} session={session_id}", flush=True)
    return order_id, recalc_total




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
    session_id = generate_session_id()
    print(f"[SESSION] New session: {session_id}", flush=True)
    loop = asyncio.get_running_loop()
    transcript_queue: asyncio.Queue[str] = asyncio.Queue()

    # One ConversationManager per WebSocket session
    conv_manager = ConversationManager(session_id=session_id)

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
    confirmation_timeout_task: Optional[asyncio.Task] = None
    CONFIRMATION_TIMEOUT_SECS = 10

    async def run_confirmation_timeout():
        """
        Waits CONFIRMATION_TIMEOUT_SECS seconds.
        If state is still ORDER_CONFIRM, injects CONFIRMATION_TIMEOUT 
        into transcript_queue so conversation_manager can handle it.
        Runs as a separate task — does NOT touch the receive loop.
        """
        await asyncio.sleep(CONFIRMATION_TIMEOUT_SECS)
        if conv_manager.state == "ORDER_CONFIRM":
            print(f"[TIMEOUT] No confirmation received after {CONFIRMATION_TIMEOUT_SECS}s", flush=True)
            transcript_queue.put_nowait("CONFIRMATION_TIMEOUT")

    # Turn detection guard: prevents EagerEndOfTurn from double-processing
    # when EndOfTurn fires very shortly after.
    last_end_of_turn_time: float = 0.0    # monotonic time
    EAGER_GUARD_SECS: float = 0.8         # 800ms — skip EagerEndOfTurn if EndOfTurn fired recently

    def deepgram_thread_fn():
        """
        Runs in a background thread.
        Opens Deepgram v1 WebSocket (linear16/16000Hz — VAD output format).
        Forwards audio chunks, receives ListenV1Results/ListenV1UtteranceEnd messages via event callbacks,
        puts final transcripts in queue.
        """
        nonlocal dg_socket
        from deepgram.listen.v1.types import ListenV1Results, ListenV1UtteranceEnd
        from deepgram.core.events import EventType

        last_speech_final_time: float = 0.0
        accumulated_transcript: str = ""

        def on_message_callback(message):
            nonlocal last_speech_final_time, accumulated_transcript
            if stop_event.is_set():
                return

            now = _time.monotonic()

            if isinstance(message, ListenV1Results):
                alternatives = getattr(getattr(message, "channel", None), "alternatives", [])
                if not alternatives:
                    return
                transcript = (alternatives[0].transcript or "").strip()

                # TYPE A: ListenV1Results where speech_final=True
                if getattr(message, "speech_final", False):
                    if transcript:
                        last_speech_final_time = now
                        loop.call_soon_threadsafe(transcript_queue.put_nowait, transcript)
                        print(f"[speech_final]: {transcript}", flush=True)
                        accumulated_transcript = ""

                # TYPE B: ListenV1Results where is_final=True but speech_final=False
                elif getattr(message, "is_final", False):
                    if transcript:
                        if accumulated_transcript:
                            accumulated_transcript += " " + transcript
                        else:
                            accumulated_transcript = transcript
                        print(f"[is_final interim]: {transcript}", flush=True)

            # TYPE C: ListenV1UtteranceEnd
            elif isinstance(message, ListenV1UtteranceEnd):
                if accumulated_transcript:
                    print(f"[UtteranceEnd fallback]: {accumulated_transcript}", flush=True)
                    loop.call_soon_threadsafe(transcript_queue.put_nowait, accumulated_transcript)
                    accumulated_transcript = ""
                    last_speech_final_time = now

        def on_error_callback(error):
            if not stop_event.is_set():
                print(f"[ERROR Deepgram event]: {error}", flush=True)

        while not stop_event.is_set():
            try:
                print(f"[DEEPGRAM] Connecting to model: {dg_model}...", flush=True)
                with dg_client.listen.v1.connect(
                    model=dg_model,
                    language="multi",
                    encoding="linear16",
                    sample_rate=16000,
                    interim_results=True,
                    endpointing=300,
                    utterance_end_ms=1000,
                    smart_format=True,
                    keyterm=[
                        "Chicken Karahi", "Mutton Karahi", "Beef Burger", "Chicken Burger",
                        "Zeera Rice", "Chicken Biryani", "Seekh Kebab", "Mango Shake",
                        "Dal Makhani", "Garlic Naan", "Nihari", "Naan", "Roti", "Pepsi",
                    ],
                ) as socket:
                    print(f"[DEEPGRAM] Connected successfully to model: {dg_model}", flush=True)
                    dg_socket = socket

                    # Flush any audio that arrived before socket was ready
                    with audio_lock:
                        for chunk in audio_buffer:
                            socket.send_media(chunk)
                        audio_buffer.clear()

                    # Start background keepalive thread to prevent NET-0001 (1011 timeout) during silence
                    def keepalive_fn():
                        while not stop_event.is_set():
                            _time.sleep(3.5)
                            if stop_event.is_set() or dg_socket is None:
                                break
                            try:
                                # Send 200ms of silent PCM audio (16000 * 2 * 0.2 = 6400 bytes of zeros)
                                socket.send_media(b"\x00" * 6400)
                            except Exception:
                                break

                    ka_thread = threading.Thread(target=keepalive_fn, daemon=True)
                    ka_thread.start()

                    # Event-based callback pattern for listen.v1
                    socket.on(EventType.MESSAGE, on_message_callback)
                    socket.on(EventType.ERROR, on_error_callback)
                    socket.start_listening()

            except Exception as e:
                dg_socket = None
                if not stop_event.is_set():
                    print(f"[ERROR Deepgram thread]: {e}. Retrying connection in 1.5 seconds...", flush=True)
                    _time.sleep(1.5)

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
                    print(f"[AUDIO RECEIVED] Received {len(chunk)} bytes (dg_socket={'READY' if dg_socket else 'NULL'})", flush=True)
                    # Append 800ms of silent PCM16 audio (16000Hz * 2 bytes * 0.8s = 25600 bytes of zeros)
                    # This guarantees Deepgram's endpointing immediately detects the utterance end and triggers speech_final=True!
                    silence_padding = b"\x00" * 25600
                    payload = chunk + silence_padding
                    if dg_socket is not None:
                        try:
                            dg_socket.send_media(payload)
                        except Exception as e:
                            print(f"[Deepgram send error]: {e}", flush=True)
                            with audio_lock:
                                audio_buffer.append(payload)
                    else:
                        print(f"[AUDIO BUFFERED] dg_socket is None, buffering {len(payload)} bytes", flush=True)
                        with audio_lock:
                            audio_buffer.append(payload)

                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type", "")

                        if msg_type == "interruption":
                            # Customer started speaking while AI was talking
                            print("[INTERRUPTION] Frontend interrupted AI speech", flush=True)
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
            print(f"[WebSocket receive error]: {e}", flush=True)

    async def process_transcripts_and_respond():
        """
        Consumes completed utterances from queue.
        Runs LLM, sends state update JSON, sends TTS audio.
        Respects interrupt_flag — discards TTS if interrupted mid-stream.
        """
        nonlocal confirmation_timeout_task
        try:
            while True:
                sentence = await transcript_queue.get()
                print(f"[PROCESSING]: {sentence}", flush=True)

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
                    print("[INTERRUPTION] Discarding LLM response — customer spoke again", flush=True)
                    transcript_queue.task_done()
                    continue

                action = response_dict.get("action", "none")
                if action == "send_to_kitchen":
                    try:
                        db = get_supabase()
                        order_id, committed_total = await asyncio.to_thread(
                            commit_order,
                            response_dict["current_order"],
                            response_dict["order_total"],
                            session_id,
                            db,
                        )
                        print(f"[TICKET] Session={session_id} Token={session_id[-4:]} Total=PKR {committed_total}", flush=True)
                        
                        await websocket.send_json({
                            "type": "order_confirmed",
                            "order_id": order_id,
                            "session_id": session_id,
                            "token": session_id[-4:],
                            "order_total": committed_total,
                            "items": response_dict["current_order"],
                        })
                        
                        resp_text = response_dict.get("response_text", "")
                        if resp_text and resp_text.strip() and not interrupt_flag.is_set():
                            audio_bytes = await asyncio.to_thread(generate_speech, resp_text)
                            if audio_bytes and not interrupt_flag.is_set():
                                try:
                                    await websocket.send_bytes(audio_bytes)
                                except Exception:
                                    break
                    except Exception as e:
                        print(f"[COMMIT ERROR] {e}", flush=True)
                        await websocket.send_json({
                            "type": "state_update",
                            "state": "TAKING_ORDER",
                            "current_order": response_dict.get("current_order", []),
                            "order_total": response_dict.get("order_total", 0),
                            "response_text": "Maafi chahta hoon, ek masla aa gaya. Kya aap apna order dobara confirm kar sakte hain?",
                            "session_id": session_id,
                        })
                        audio = await asyncio.to_thread(
                            generate_speech,
                            "Maafi chahta hoon, ek masla aa gaya. Order dobara confirm karein."
                        )
                        if audio and not interrupt_flag.is_set():
                            try:
                                await websocket.send_bytes(audio)
                            except Exception:
                                break
                elif action == "session_timeout":
                    print(f"[TIMEOUT] Session {session_id} timed out at ORDER_CONFIRM", flush=True)
                    await websocket.send_json({
                        "type": "session_timeout",
                        "session_id": session_id,
                    })
                    resp_text = response_dict.get("response_text", "")
                    if resp_text and resp_text.strip() and not interrupt_flag.is_set():
                        audio_bytes = await asyncio.to_thread(generate_speech, resp_text)
                        if audio_bytes and not interrupt_flag.is_set():
                            try:
                                await websocket.send_bytes(audio_bytes)
                            except Exception:
                                break
                else:
                    # Send state update to browser
                    state_msg = {
                        "type": "state_update",
                        "state": response_dict.get("state", "SLEEPING"),
                        "current_order": response_dict.get("current_order", []),
                        "order_total": response_dict.get("order_total", 0),
                        "response_text": response_dict.get("response_text", ""),
                        "action": action,
                        "session_id": conv_manager.session_id,
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
                            print("[INTERRUPTION] TTS audio discarded — customer interrupted", flush=True)

                # Manage confirmation timeout task
                current_state = response_dict.get("state", "SLEEPING") if action not in ["send_to_kitchen", "session_timeout"] else "SLEEPING"
                if current_state == "ORDER_CONFIRM":
                    if confirmation_timeout_task and not confirmation_timeout_task.done():
                        confirmation_timeout_task.cancel()
                    confirmation_timeout_task = asyncio.create_task(run_confirmation_timeout())
                else:
                    if confirmation_timeout_task and not confirmation_timeout_task.done():
                        confirmation_timeout_task.cancel()
                        confirmation_timeout_task = None

                transcript_queue.task_done()

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Transcript processing error]: {e}", flush=True)

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
                "action": "none",
                "session_id": conv_manager.session_id,
            })
            audio_bytes = await asyncio.to_thread(generate_speech, greeting_text)
            if audio_bytes and not interrupt_flag.is_set():
                await websocket.send_bytes(audio_bytes)
        except Exception as e:
            print(f"[Initial greeting error]: {e}", flush=True)

    asyncio.create_task(send_initial_greeting())
    t1 = asyncio.create_task(receive_from_browser())
    t2 = asyncio.create_task(process_transcripts_and_respond())

    try:
        done, pending = await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    finally:
        if confirmation_timeout_task and not confirmation_timeout_task.done():
            confirmation_timeout_task.cancel()
        stop_event.set()
        if dg_socket:
            try:
                dg_socket.send_close_stream()
            except Exception:
                pass
        print("[WebSocket] Session ended, Deepgram thread stopping", flush=True)


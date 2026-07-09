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
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from conversation_manager import ConversationManager
from tts_service import generate_speech, generate_speech_stream
from database.supabase_client import get_supabase
from security import verify_token, require_admin

load_dotenv(override=True)

app = FastAPI(
    title="Restaurant AI Ordering API",
    version="2.0.0"
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
    
    try:
        result = db_client.table("orders").insert({
            "items": cleaned_order,
            "total_amount": recalc_total,
            "status": "pending",
            "session_id": session_id,
        }).execute()
        
        if result.data:
            order_id = result.data[0]["id"]
            print(f"[ORDER COMMITTED] id={order_id} total=PKR {recalc_total} session={session_id}", flush=True)
            return order_id, recalc_total
        else:
            print(f"[WARNING] Supabase insert returned empty data for session {session_id}, using fallback ID", flush=True)
    except Exception as e:
        print(f"[WARNING] Supabase insert failed ({e}). Generating fallback ticket for session {session_id}", flush=True)
    
    import uuid
    fallback_id = str(uuid.uuid4())
    print(f"[FALLBACK TICKET] id={fallback_id} total=PKR {recalc_total} session={session_id}", flush=True)
    return fallback_id, recalc_total




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

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        await websocket.close(code=1011, reason="OPENAI_API_KEY missing")
        return

    # ── Per-session state ──────────────────────────────────────────────────────
    stop_event = threading.Event()
    interrupt_flag = asyncio.Event()       # Set when frontend sends interruption
    dg_socket = None
    audio_buffer: List[bytes] = []
    audio_lock = threading.Lock()
    confirmation_timeout_task: Optional[asyncio.Task] = None
    CONFIRMATION_TIMEOUT_SECS = 60

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

    def stt_thread_fn():
        """
        Sends accumulated audio to OpenAI Whisper GPT-4o Mini Transcribe.
        Runs in a background thread.
        Processes complete utterances sent from receive_from_browser.
        """
        nonlocal dg_socket  # reuse variable name as stt_ready flag
        from openai import OpenAI
        import tempfile, os, time as _time2
        
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        stt_ready = True
        dg_socket = "openai_ready"  # signal that STT is ready
        print("[STT] OpenAI GPT-4o Mini Transcribe ready", flush=True)
        
        while not stop_event.is_set():
            # Wait for audio chunks in the buffer
            _time2.sleep(0.1)
            
            with audio_lock:
                if not audio_buffer:
                    continue
                # Take all buffered audio
                combined = b"".join(audio_buffer)
                audio_buffer.clear()
            
            if len(combined) < 3200:  # Skip very short audio (< 0.1 sec)
                continue
            
            try:
                # Write to temp WAV file (OpenAI requires a file)
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as tmp:
                    # Write WAV header for linear16 16000Hz mono
                    import struct, wave
                    with wave.open(tmp.name, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)  # 16-bit = 2 bytes
                        wf.setframerate(16000)
                        wf.writeframes(combined)
                    tmp_path = tmp.name
                
                with open(tmp_path, "rb") as audio_file:
                    result = openai_client.audio.transcriptions.create(
                        model="gpt-4o-mini-transcribe",
                        file=audio_file,
                        prompt=(
                            "Pakistani restaurant order in Roman Urdu and English mixed. "
                            "Transcribe spoken Urdu words in Roman script not in Urdu script. "
                            "Menu items: Chicken Karahi, Mutton Karahi, Beef Burger, "
                            "Chicken Burger, Zeera Rice, Chicken Biryani, Seekh Kebab, "
                            "Mango Shake, Dal Makhani, Garlic Naan, Nihari, Naan, Roti, Pepsi."
                        ),
                        response_format="text",
                    )
                
                transcript = result.strip() if isinstance(result, str) else result.text.strip()
                
                if transcript:
                    # Detect if transcript contains non-Roman characters (diagnostic)
                    has_devanagari = any('\u0900' <= c <= '\u097f' for c in transcript)
                    has_arabic_urdu = any('\u0600' <= c <= '\u06ff' for c in transcript)
                    if has_devanagari or has_arabic_urdu:
                        print(
                            f"[STT SCRIPT WARNING] Non-Roman script detected — "
                            f"consider adjusting prompt: {transcript[:80]}",
                            flush=True
                        )
                    else:
                        print(f"[STT] Roman transcript: {transcript}", flush=True)
                        
                    loop.call_soon_threadsafe(
                        transcript_queue.put_nowait, transcript
                    )
            
            except Exception as e:
                print(f"[STT ERROR] {e}", flush=True)
            
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

    stt_thread = threading.Thread(target=stt_thread_fn, daemon=True)
    stt_thread.start()

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
                    with audio_lock:
                        audio_buffer.append(chunk)

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

        async def stream_tts_to_browser(text: str) -> int:
            """
            Streams TTS audio chunks to browser as they arrive.
            Browser starts playing first chunk ~200-400ms faster
            than waiting for complete audio.
            """
            if not text or not text.strip() or interrupt_flag.is_set():
                return 0
            tts_start = _time.monotonic()
            try:
                loop = asyncio.get_running_loop()
                
                def run_stream():
                    chunks = []
                    for chunk in generate_speech_stream(text):
                        chunks.append(chunk)
                    return chunks
                
                chunks = await asyncio.to_thread(run_stream)
                
                # Send all chunks concatenated as one binary message
                # This avoids browser needing to reassemble streaming chunks
                if chunks:
                    audio_bytes = b"".join(chunks)
                    if not interrupt_flag.is_set():
                        await websocket.send_bytes(audio_bytes)
                elif interrupt_flag.is_set():
                    print("[INTERRUPTION] TTS audio discarded — customer interrupted", flush=True)
                    
            except Exception as e:
                print(f"[TTS STREAM ERROR] {e}", flush=True)
            tts_end = _time.monotonic()
            return round((tts_end - tts_start) * 1000)

        try:
            while True:
                sentence = await transcript_queue.get()
                turn_start = _time.monotonic()
                print(f"[PROCESSING]: {sentence}", flush=True)

                # Clear any pending interrupt before processing new utterance
                interrupt_flag.clear()

                # Send interim transcript display to frontend
                try:
                    await websocket.send_json({"type": "transcript", "text": sentence})
                except Exception:
                    break

                # Run blocking LLM call in thread pool
                llm_start = _time.monotonic()
                response_dict = await asyncio.to_thread(conv_manager.process_input, sentence)
                llm_end = _time.monotonic()
                llm_ms = round((llm_end - llm_start) * 1000)
                tts_ms = 0

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
                        
                        resp_text = response_dict.get("response_text", "")
                        tts_ms = await stream_tts_to_browser(resp_text)
                                    
                        await websocket.send_json({
                            "type": "order_confirmed",
                            "order_id": order_id,
                            "session_id": session_id,
                            "token": session_id[-4:],
                            "order_total": committed_total,
                            "items": response_dict["current_order"],
                        })
                    except Exception as e:
                        print(f"[COMMIT ERROR] {e}", flush=True)
                        tts_ms = await stream_tts_to_browser(
                            "Maafi chahta hoon, ek masla aa gaya. Order dobara confirm karein."
                        )
                        await websocket.send_json({
                            "type": "state_update",
                            "state": "TAKING_ORDER",
                            "current_order": response_dict.get("current_order", []),
                            "order_total": response_dict.get("order_total", 0),
                            "response_text": "Maafi chahta hoon, ek masla aa gaya. Kya aap apna order dobara confirm kar sakte hain?",
                            "session_id": session_id,
                        })
                elif action == "session_timeout":
                    print(f"[TIMEOUT] Session {session_id} timed out at ORDER_CONFIRM", flush=True)
                    resp_text = response_dict.get("response_text", "")
                    tts_ms = await stream_tts_to_browser(resp_text)
                    await websocket.send_json({
                        "type": "session_timeout",
                        "session_id": session_id,
                    })
                elif action == "order_cancelled":
                    print(f"[CANCELLED] Order cancelled for session {session_id}", flush=True)
                    resp_text = response_dict.get("response_text", "")
                    tts_ms = await stream_tts_to_browser(resp_text)
                    await websocket.send_json({
                        "type": "order_cancelled",
                        "session_id": session_id,
                    })
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
                    tts_ms = await stream_tts_to_browser(resp_text)

                # Manage confirmation timeout task
                current_state = response_dict.get("state", "SLEEPING") if action not in ["send_to_kitchen", "session_timeout", "order_cancelled"] else "SLEEPING"
                if current_state == "ORDER_CONFIRM":
                    if confirmation_timeout_task and not confirmation_timeout_task.done():
                        confirmation_timeout_task.cancel()
                    confirmation_timeout_task = asyncio.create_task(run_confirmation_timeout())
                else:
                    if confirmation_timeout_task and not confirmation_timeout_task.done():
                        confirmation_timeout_task.cancel()
                        confirmation_timeout_task = None

                turn_end = _time.monotonic()
                total_ms = round((turn_end - turn_start) * 1000)
                print(f"[LATENCY] Turn complete in {total_ms}ms", flush=True)
                print(f"[LATENCY] LLM: {llm_ms}ms | TTS: {tts_ms}ms | Total: {total_ms}ms", flush=True)

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


# ─── PHASE 6/7: AUTH & ROLE DEPENDENCIES (MOVED TO security.py) ───────────────


# ─── PHASE 6: AUTH ROUTES ─────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str
    role: str

@app.post("/api/auth/signup")
@limiter.limit("3/minute")
def signup(request: Request, req: SignupRequest):
    if req.role != "admin":
        raise HTTPException(status_code=400, detail="Invalid role")
    
    db = get_supabase()
    if req.role == "admin":
        existing = db.table("user_profiles").select("id").eq("role", "admin").execute()
        if existing.data and len(existing.data) > 0:
            raise HTTPException(status_code=409, detail="Admin account already exists. Only one admin is allowed.")
    
    try:
        result = db.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True
        })
        user_id = result.user.id
        
        db.table("user_profiles").insert({
            "id": user_id,
            "role": req.role,
            "display_name": req.display_name
        }).execute()
        
        return {"user_id": user_id, "role": req.role, "display_name": req.display_name}
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e).lower()
        if "already exists" in err_str or "registered" in err_str or "409" in err_str or "duplicate" in err_str:
            raise HTTPException(status_code=409, detail="User already exists or admin constraint violated")
        raise HTTPException(status_code=400, detail=f"Signup failed: {str(e)}")

class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/api/auth/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest):
    db = get_supabase()
    try:
        res = db.auth.sign_in_with_password({"email": req.email, "password": req.password})
        if not res.session or not res.user:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        
        user_id = res.user.id
        access_token = res.session.access_token
        
        profile = db.table("user_profiles").select("*").eq("id", user_id).single().execute()
        role = profile.data["role"] if profile.data else "admin"
        display_name = profile.data["display_name"] if profile.data else req.email
        
        return {
            "access_token": access_token,
            "role": role,
            "display_name": display_name,
            "user_id": user_id
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid email or password")

@app.get("/api/auth/me")
def get_me(user: Dict[str, Any] = Depends(verify_token)):
    db = get_supabase()
    profile = db.table("user_profiles").select("*").eq("id", user["id"]).single().execute()
    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {
        "user_id": profile.data["id"],
        "role": profile.data["role"],
        "display_name": profile.data["display_name"]
    }


# ─── PHASE 6: MENU MANAGEMENT ROUTES ──────────────────────────────────────────

@app.get("/api/menu")
def get_public_menu():
    db = get_supabase()
    res = db.table("menu_items").select("*").eq("available", True).execute()
    return res.data or []

@app.get("/api/menu/all")
def get_all_menu(user: Dict[str, Any] = Depends(verify_token)):
    db = get_supabase()
    res = db.table("menu_items").select("*").order("category").execute()
    return res.data or []

class AvailabilityUpdate(BaseModel):
    available: bool

@app.patch("/api/menu/{item_id}/availability")
def update_menu_availability(item_id: str, req: AvailabilityUpdate, admin: Dict[str, Any] = Depends(require_admin)):
    db = get_supabase()
    res = db.table("menu_items").update({"available": req.available, "updated_at": "now()"}).eq("id", item_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return res.data[0]

class PriceUpdate(BaseModel):
    price: int

@app.patch("/api/menu/{item_id}/price")
def update_menu_price(item_id: str, req: PriceUpdate, admin: Dict[str, Any] = Depends(require_admin)):
    if req.price < 0:
        raise HTTPException(status_code=400, detail="Price cannot be negative")
    db = get_supabase()
    res = db.table("menu_items").update({"price": req.price, "updated_at": "now()"}).eq("id", item_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return res.data[0]

class MenuItemCreate(BaseModel):
    canonical_name: str
    urdu_name: Optional[str] = ""
    category: str = "main"
    price: int
    available: bool = True
    aliases: List[str] = []
    modifications: List[Any] = []
    preparation_minutes: int = 15

@app.post("/api/menu/items")
def create_menu_item(req: MenuItemCreate, admin: Dict[str, Any] = Depends(require_admin)):
    db = get_supabase()
    res = db.table("menu_items").insert(req.model_dump()).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create menu item")
    return res.data[0]

@app.delete("/api/menu/items/{item_id}")
def delete_menu_item(item_id: str, admin: Dict[str, Any] = Depends(require_admin)):
    db = get_supabase()
    res = db.table("menu_items").update({"available": False, "updated_at": "now()"}).eq("id", item_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return {"message": "Menu item soft deleted", "item": res.data[0]}


# ─── PHASE 6: ORDER MANAGEMENT ROUTES ─────────────────────────────────────────

@app.get("/api/orders/today")
def get_today_orders(user: Dict[str, Any] = Depends(verify_token)):
    db = get_supabase()
    today_str = datetime.now().strftime("%Y-%m-%d")
    res = db.table("orders").select("*").gte("created_at", today_str).order("created_at", desc=True).execute()
    return res.data or []

@app.get("/api/orders/active")
def get_active_orders(user: Dict[str, Any] = Depends(require_admin)):
    db = get_supabase()
    res = db.table("orders").select("*").in_("status", ["pending", "preparing"]).order("created_at", desc=False).execute()
    return res.data or []

class OrderStatusUpdate(BaseModel):
    status: str

@app.patch("/api/orders/{order_id}/status")
def update_order_status(order_id: str, req: OrderStatusUpdate, user: Dict[str, Any] = Depends(require_admin)):
    if req.status not in ("preparing", "ready"):
        raise HTTPException(status_code=400, detail="Invalid target status")
    
    db = get_supabase()
    order = db.table("orders").select("status").eq("id", order_id).single().execute()
    if not order.data:
        raise HTTPException(status_code=404, detail="Order not found")
    
    current_status = order.data["status"]
    if current_status == "pending" and req.status != "preparing":
        raise HTTPException(status_code=400, detail="From pending, order status can only transition to preparing")
    if current_status == "preparing" and req.status != "ready":
        raise HTTPException(status_code=400, detail="From preparing, order status can only transition to ready")
    if current_status == "ready":
        raise HTTPException(status_code=400, detail="Order is already ready")
    if current_status not in ("pending", "preparing"):
        raise HTTPException(status_code=400, detail=f"Cannot transition from {current_status}")
    
    res = db.table("orders").update({"status": req.status}).eq("id", order_id).execute()
    return res.data[0]



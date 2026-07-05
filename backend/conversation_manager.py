import os
import json
import time
import re
import uuid
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq
from database.supabase_client import get_supabase

load_dotenv()

VALID_STATES = [
    "SLEEPING",
    "GREETING",
    "TAKING_ORDER",
    "ITEM_DISAMBIGUATION",
    "QUANTITY_CONFIRM",
    "ADD_MORE",
    "MENU_QUERY",
    "ORDER_CONFIRM",
]

WAKE_WORDS = [
    "hello ai receptionist",
    "hello ai",
    "hi ai receptionist",
]

SYSTEM_PROMPT_TEMPLATE = """You are an AI Receptionist for Savour Foods restaurant, taking voice orders from customers in Urdu-English code-switched language (e.g., "Chicken karahi chahiye, 1 kg", "Two beef burgers without onion").

Current State: {current_state}
Current Order JSON: {current_order}
Current Order Total: {order_total} PKR

=== MENU ===
{menu_string}
============

VALID STATES:
- SLEEPING: Waiting for wake word.
- GREETING: Welcoming customer after wake word.
- TAKING_ORDER: Customer is specifying menu items.
- ITEM_DISAMBIGUATION: Clarifying item details (e.g., asking Chicken/Mutton/Beef for Karahi, or half/full portion).
- QUANTITY_CONFIRM: Confirming quantity of an item before adding it to current_order.
- ADD_MORE: Asking if the customer wants anything else ("Kuch aur chahiye?").
- MENU_QUERY: Answering questions about menu items or prices.
- ORDER_CONFIRM: Final order readback and sending to kitchen.

STRICT RULES:
1. Never confirm an item not in the menu.
2. Never invent prices — use only prices from menu JSON.
3. Never add an item to current_order until quantity is confirmed!
4. Always respond in Urdu-English code-switched language.
5. For karahi items, always ask variant (chicken/mutton/beef) before quantity! If customer just says "karahi", transition to ITEM_DISAMBIGUATION and ask which type.
6. Irrelevant questions (weather, politics, anything non-food): respond "Main sirf orders le sakta hoon. Kya aap kuch order karna chahenge?" and stay in current state.
7. Out of stock: say "Sorry, [item] abhi available nahi hai. Kya aur kuch chahiye?"
8. Item not on menu: say "Sorry, yeh item hamare menu mein nahi hai."
9. On ORDER_CONFIRM read back complete order with prices and total, then say "Apna ticket aur bill POS se hasil karein. Shukriya!" and set action="send_to_kitchen".

You MUST respond with ONLY valid JSON matching this exact structure (no markdown fences, no extra text):
{{
  "response_text": "Your Urdu-English spoken response to the customer",
  "next_state": "ONE_OF_THE_VALID_STATES",
  "current_order": [ {{"name": "Item Name", "qty": 1, "price": 850, "mods": []}} ],
  "order_total": 850,
  "action": "none"
}}
"""


class ConversationManager:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.state = "SLEEPING"
        self.current_order: List[Dict[str, Any]] = []
        self.order_total = 0
        self.history: List[Dict[str, str]] = []
        
        # Load menu
        menu_path = Path(__file__).parent / "data" / "menu.json"
        if not menu_path.exists():
            menu_path = Path(__file__).parent.parent / "backend" / "data" / "menu.json"
        with open(menu_path, "r", encoding="utf-8") as f:
            self.menu_data = json.load(f)
            
        self.menu_string = self._build_compact_menu()
        
        # Init Groq client
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set in environment")
        self.groq_client = Groq(api_key=api_key)

    def _build_compact_menu(self) -> str:
        lines = []
        for cat in self.menu_data.get("categories", []):
            lines.append(f"--- {cat['name']} ---")
            for item in cat.get("items", []):
                status = "AVAILABLE" if item.get("available", True) else "OUT OF STOCK"
                aliases = ", ".join(item.get("aliases", []))
                mods = ", ".join([
                    f"{m['name']} ({m.get('urdu', '')}): {m['price_delta']:+d} PKR"
                    for m in item.get("modifications", [])
                ])
                line = f"ID: {item['id']} | {item['canonical_name']} ({item.get('urdu_name', '')}) | Price: {item['price']} PKR | Status: {status} | Aliases: [{aliases}]"
                if mods:
                    line += f" | Mods: [{mods}]"
                lines.append(line)
        return "\n".join(lines)

    def reset(self):
        self.state = "SLEEPING"
        self.current_order = []
        self.order_total = 0
        self.history = []
        self.session_id = str(uuid.uuid4())

    def _strip_code_fences(self, text: str) -> str:
        text = text.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
        text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
        return text.strip()

    def _get_fallback_response(self) -> Dict[str, Any]:
        return {
            "response_text": "Maaf kijiye, main samajh nahi paya. Kya aap dobara bolenge?",
            "state": self.state,
            "next_state": self.state,
            "current_order": self.current_order,
            "order_total": self.order_total,
            "action": "none",
        }

    def process_input(self, user_input: str) -> Dict[str, Any]:
        user_input_clean = user_input.strip()
        if not user_input_clean:
            return {
                "response_text": "",
                "state": self.state,
                "next_state": self.state,
                "current_order": self.current_order,
                "order_total": self.order_total,
                "action": "none",
            }

        # SLEEPING state check
        if self.state == "SLEEPING":
            user_lower = user_input_clean.lower()
            if any(w in user_lower for w in WAKE_WORDS):
                self.state = "GREETING"
            else:
                return {
                    "response_text": "",
                    "state": "SLEEPING",
                    "next_state": "SLEEPING",
                    "current_order": self.current_order,
                    "order_total": self.order_total,
                    "action": "none",
                }

        # Build system prompt
        sys_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            current_state=self.state,
            current_order=json.dumps(self.current_order, ensure_ascii=False),
            order_total=self.order_total,
            menu_string=self.menu_string,
        )

        # Cap history at last 10 turns (5 user + 5 assistant)
        messages = [{"role": "system", "content": sys_prompt}]
        messages.extend(self.history[-10:])
        messages.append({"role": "user", "content": user_input_clean})

        # Add sleep for Groq free tier rate limit
        time.sleep(2)

        try:
            completion = self.groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                temperature=0.2,
                max_tokens=500,
            )
            raw_content = completion.choices[0].message.content or ""
            cleaned_json = self._strip_code_fences(raw_content)
            
            try:
                data = json.loads(cleaned_json)
            except json.JSONDecodeError:
                # Try to find JSON block if extra text exists
                match = re.search(r"\{.*\}", cleaned_json, re.DOTALL)
                if match:
                    try:
                        data = json.loads(match.group(0))
                    except json.JSONDecodeError:
                        return self._get_fallback_response()
                else:
                    return self._get_fallback_response()

            response_text = data.get("response_text", "")
            next_state = data.get("next_state", self.state)
            current_order = data.get("current_order", self.current_order)
            order_total = data.get("order_total", self.order_total)
            action = data.get("action", "none")

            # Validate state transition
            if next_state in VALID_STATES:
                self.state = next_state
            else:
                # Reject invalid transition, stay in current state
                next_state = self.state

            self.current_order = current_order
            self.order_total = order_total

            # Update conversation history
            self.history.append({"role": "user", "content": user_input_clean})
            self.history.append({"role": "assistant", "content": response_text})

            # Check if order confirmed
            if self.state == "ORDER_CONFIRM" and action == "send_to_kitchen":
                try:
                    db = get_supabase()
                    db.table("orders").insert({
                        "items": self.current_order,
                        "total_amount": self.order_total,
                        "status": "pending",
                        "session_id": self.session_id,
                    }).execute()
                except Exception as e:
                    print(f"[ERROR] Failed to write order to Supabase: {e}")
                
                # We save state before reset to return in response
                final_response = {
                    "response_text": response_text,
                    "state": "ORDER_CONFIRM",
                    "next_state": "ORDER_CONFIRM",
                    "current_order": self.current_order,
                    "order_total": self.order_total,
                    "action": action,
                }
                self.reset()
                return final_response

            return {
                "response_text": response_text,
                "state": self.state,
                "next_state": self.state,
                "current_order": self.current_order,
                "order_total": self.order_total,
                "action": action,
            }

        except Exception as e:
            print(f"[ERROR] LLM call failed: {e}")
            return self._get_fallback_response()

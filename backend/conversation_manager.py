"""
ConversationManager — Phase 4
Upgrades over Phase 3:
- History cap raised from 10 → 20 turns
- Multi-item parsing rules in system prompt
- Order modification rules (remove, replace, clear, increment)
- accumulated_interim attribute (for interruption reset signal)
"""

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

SYSTEM_PROMPT_TEMPLATE = """\
You are an AI Receptionist for Savour Foods restaurant, taking voice orders from customers \
in Urdu-English code-switched language (e.g., "Chicken karahi chahiye, 1 kg", "Two beef burgers without onion").

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
- ITEM_DISAMBIGUATION: Clarifying item details (e.g., asking Chicken/Mutton/Beef for Karahi).
- QUANTITY_CONFIRM: Confirming quantity of an item before adding it to current_order.
- ADD_MORE: Asking if the customer wants anything else ("Kuch aur chahiye?").
- MENU_QUERY: Answering questions about menu items or prices.
- ORDER_CONFIRM: Final order readback and sending to kitchen.

STRICT RULES — ALWAYS FOLLOW:
1. Never confirm an item not in the menu.
2. Never invent prices — use only prices from menu JSON.
3. Never add an item to current_order until quantity is confirmed!
4. Always respond in Urdu-English code-switched language.
5. For karahi items, always ask variant (chicken/mutton/beef) before quantity! \
   If customer just says "karahi", transition to ITEM_DISAMBIGUATION and ask which type.
6. Irrelevant questions (weather, politics, non-food): respond \
   "Main sirf orders le sakta hoon. Kya aap kuch order karna chahenge?" and stay in current state.
7. Out of stock: say "Sorry, [item] abhi available nahi hai. Kya aur kuch chahiye?"
8. Item not on menu: say "Sorry, yeh item hamare menu mein nahi hai."
9. When transitioning to ORDER_CONFIRM (or confirming order): YOU MUST read back the COMPLETE order \
   with item names, quantities, individual prices, and order_total! For example: "Aap ka order confirm kar diya hai. \
   Ek Daal Makhani 250 PKR, Ek Pepsi 80 PKR. Aap ka total bill 330 PKR hai. Apni receipt POS machine se collect kar lein. \
   Order karne ka shukriya!" And set next_state="ORDER_CONFIRM" and action="send_to_kitchen". \
   NEVER just say "Aap ka order confirm hai" without listing all items and total!

MULTI-ITEM RULES:
10. Customer may name multiple items in one utterance: "ek karahi aur do naan"
    - Parse ALL items from the utterance.
    - Process them in order: if any item needs disambiguation (e.g., karahi variant), \
      handle that first before moving to the next item.
    - If ALL items have clear quantities and no ambiguity, add ALL to current_order in one response, \
      then transition to ADD_MORE.
    - Never skip an item because it appears later in the utterance.

ORDER MODIFICATION RULES:
11. "woh wala nahi chahiye" / "remove [item]" / "hatao [item]" / "[item] nahi chahiye" \
    → Remove that item from current_order. Confirm what was removed. Read back the remaining order.
12. "change karo [item] ko [new item]" → Replace item in current_order with the new item. Confirm.
13. "cancel sab" / "sab hatao" / "poora cancel" / "naya order" \
    → Clear entire current_order completely. Set order_total to 0. Transition to TAKING_ORDER. \
    Confirm: "Aap ka poora order cancel ho gaya. Kya naya order dena chahenge?"
14. After ANY modification: set current_order and order_total correctly in your JSON response, \
    then read back the COMPLETE updated order.
15. Never remove an item without explicitly confirming WHICH item was removed.

REPEAT-ITEM RULES:
16. "ek aur [item]" / "same again" / "aur [qty] [item]" / "dobara" \
    → Increase the quantity of the existing matching item in current_order. \
    Do NOT add a duplicate line — update qty and line_total of the existing entry.
17. "same wala aur ek" → increase quantity of the most recently added item.

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

        # Phase 4: used by WebSocket handler to clear transcript on interruption
        self.accumulated_interim: str = ""

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
                line = (
                    f"ID: {item['id']} | {item['canonical_name']} ({item.get('urdu_name', '')}) "
                    f"| Price: {item['price']} PKR | Status: {status} | Aliases: [{aliases}]"
                )
                if mods:
                    line += f" | Mods: [{mods}]"
                lines.append(line)
        return "\n".join(lines)

    def reset(self):
        self.state = "SLEEPING"
        self.current_order = []
        self.order_total = 0
        self.history = []
        self.accumulated_interim = ""
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

        # SLEEPING state — check for wake word only
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

        # Phase 4: cap history at last 20 turns (up from 10 in Phase 3)
        messages = [{"role": "system", "content": sys_prompt}]
        messages.extend(self.history[-20:])
        messages.append({"role": "user", "content": user_input_clean})

        # Rate-limit guard removed for < 2s conversational turnaround
        try:
            try:
                completion = self.groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=messages,
                    temperature=0.2,
                    max_tokens=600,
                )
            except Exception as e1:
                print(f"[GROQ FALLBACK] 70B rate limited ({e1}), falling back to llama-3.1-8b-instant...", flush=True)
                try:
                    completion = self.groq_client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=messages,
                        temperature=0.2,
                        max_tokens=600,
                    )
                except Exception as e2:
                    print(f"[GROQ FALLBACK] 8B-instant rate limited ({e2}), falling back to llama3-8b-8192...", flush=True)
                    completion = self.groq_client.chat.completions.create(
                        model="llama3-8b-8192",
                        messages=messages,
                        temperature=0.2,
                        max_tokens=600,
                    )
            raw_content = completion.choices[0].message.content or ""
            cleaned_json = self._strip_code_fences(raw_content)

            try:
                data = json.loads(cleaned_json)
            except json.JSONDecodeError:
                # Try to extract JSON block if LLM added surrounding text
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
                next_state = self.state

            self.current_order = current_order
            self.order_total = order_total

            # Update conversation history (Phase 4 cap: 20 turns)
            self.history.append({"role": "user", "content": user_input_clean})
            self.history.append({"role": "assistant", "content": response_text})
            # Trim to last 20 messages (10 turns × 2)
            if len(self.history) > 20:
                self.history = self.history[-20:]

            # Handle order confirmed → write to Supabase then reset
            if self.state == "ORDER_CONFIRM" or action == "send_to_kitchen":
                action = "send_to_kitchen"
                self.state = "ORDER_CONFIRM"
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

                # Ensure complete confirmation script is read back with item details and total
                items_list = []
                for item in self.current_order:
                    qty = item.get("qty", 1)
                    name = item.get("name", "item")
                    items_list.append(f"{qty} {name}")
                items_str = ", ".join(items_list) if items_list else "aap ka order"
                response_text = (
                    f"Aap ka order confirm kar diya hai: {items_str}. "
                    f"Aap ka total hua hai {self.order_total} PKR. "
                    f"Apni receipt POS machine se collect kar lein. Order karne ka shukriya!"
                )

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

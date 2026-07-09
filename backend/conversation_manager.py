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
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq
from difflib import SequenceMatcher
from database.supabase_client import get_supabase

load_dotenv(override=True)

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
=== HARD CONSTRAINTS — NEVER VIOLATE ===
1. ONLY add items to current_order whose exact NAME appears in
   AVAILABLE MENU ITEMS above.
2. ONLY state prices from AVAILABLE MENU ITEMS. Never invent prices.
3. Before returning JSON, verify each item in current_order has a NAME
   that exactly matches a NAME in the list. Remove any that do not.
4. If uncertain which item the customer means, ASK — never guess.
5. If an item is not in the list, say:
   "Sorry, yeh item hamare menu mein nahi hai."
6. Keep ALL responses under 25 words when possible.
   Order confirmations must be brief:
   GOOD: "Beef Burger add ho gaya. Kuch aur?"
   BAD:  "Bilkul! Maine aapka Beef Burger order mein successfully 
          add kar diya hai. Kya aap aur kuch order karna chahenge?"
   Never repeat what the customer said back to them in full.
   One confirmation sentence maximum, then the next question.
========================================

=== MODIFICATION HANDLING RULES ===

DETECTING MODIFICATIONS:
The customer may request ingredient changes at any point during ordering.
Detect modifications from these patterns:

Removal patterns:
- "bina [ingredient]" / "bina [ingredient] ke" → type: remove
- "no [ingredient]" / "without [ingredient]" → type: remove
- "[ingredient] mat daalna" / "[ingredient] nahi chahiye" → type: remove
- "remove [ingredient]" / "[ingredient] hata do" → type: remove

Addition patterns:
- "extra [ingredient]" / "zyada [ingredient]" → type: add
- "add [ingredient]" / "[ingredient] bhi daalna" → type: add
- "double [ingredient]" → type: add

Substitution patterns:
- "[X] ki jagah [Y]" / "replace [X] with [Y]" → type: substitute
- "[X] ki bajaye [Y]" → type: substitute

Spice level patterns:
- "bina mirch" / "no spice" / "mild" → type: spice, ingredient: "mirch/spice", display: "No spice"
- "medium spicy" / "thoda teekha" → type: spice, ingredient: "mirch/spice", display: "Medium spicy"
- "zyada teekha" / "extra spicy" / "bohot teekha" → type: spice, ingredient: "mirch/spice", display: "Extra spicy"

Preparation patterns:
- "well done" / "zyada pakana" → type: preparation, display: "Well done"
- "crispy" / "crispy karna" → type: preparation, display: "Extra crispy"
- "alag plate mein" / "separate plate" → type: preparation, display: "Separate plate"
- Any other cooking instruction → type: preparation

WHEN TO ATTACH A MODIFICATION:
Attach the modification to the most recently mentioned item in the conversation.
If the customer says "bina pyaz ke" right after mentioning "burger", attach to burger.
If no item context is clear, ask: "Kis item mein yeh change chahiye?"

MODIFICATION ON ALREADY-ADDED ITEM:
If an item is already in current_order and the customer requests a modification for it,
find that item in current_order and add the modification to its modifications array.
Do NOT add a duplicate item. Update the existing one.

CONFLICTING MODIFICATIONS:
If the customer says "extra mirch" and later says "bina mirch" for the same item,
the LAST instruction wins. Remove the earlier conflicting modification.
Conflicting pairs: (add spice / remove spice), (add ingredient / remove same ingredient)

CONFIRMING MODIFICATIONS:
After adding a modification, confirm it immediately:
"Theek hai, [item name] mein [modification] kar deta hoon."
Examples:
- "Theek hai, burger mein pyaz nahi dalunga."
- "Beef burger mein extra cheese add kar diya."
- "Chicken karahi bina mirch ke banegi."

MODIFICATION ON UNKNOWN ITEM:
If the customer says "bina pyaz" but current_order is empty or has no relevant item:
Ask: "Kis item ke liye yeh modification chahiye?"

READING BACK MODIFICATIONS IN ORDER CONFIRM:
When reading back the order in ORDER_CONFIRM state, include modifications:
"1 Beef Burger — bina pyaz, extra cheese"
NOT just "1 Beef Burger"

FREE-TEXT SPECIAL NOTES:
If the request does not fit any pattern above (e.g. "gift wrap karna",
"bachon ke liye khaas banana"), store it in special_note field.
Confirm: "Note kar liya: [special_note]"

=== END MODIFICATION RULES ===

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
9. When transitioning to ORDER_CONFIRM: YOU MUST read back the COMPLETE order \
   with each item name, quantity, and price on a separate line. \
   End with total: "Kul bill: PKR {order_total}. Kya yeh sahi hai?" \
   And set next_state="ORDER_CONFIRM" and action="none". \
   NEVER just say "Aap ka order confirm hai" without listing all items and asking confirmation!

MENU, DRINKS & CATEGORY QUERY SCENARIOS — NEVER HALLUCINATE OR SAY "MAAF KIJIYE GA":
- If customer asks about DRINKS/BEVERAGES ("drinks mein kya hai", "cold drink hai?", "peene mein kya hai", "drinks mn kiya item hai"):
  Look at items with CATEGORY: Drinks/drinks (e.g., Pepsi, Mango Shake). Respond clearly: "Drinks mein hamare paas Pepsi aur Mango Shake available hain."
- If customer asks about BREAD/ROTI ("roti naan mein kya hai", "breads kya hain", "roti mil jayegi?"):
  Look at items with CATEGORY: Bread/bread (e.g., Naan, Garlic Naan, Roti). Respond clearly: "Bread mein hamare paas Naan, Garlic Naan aur Roti available hain."
- If customer asks about MAIN COURSE/SALAN/KHANA ("salan kya hai", "khane mein kya hai", "main course batao"):
  Look at items with CATEGORY: Main Course/main (e.g., Chicken Karahi, Mutton Karahi, Chicken Biryani, Seekh Kebab, Dal Makhani, Zeera Rice, Nihari). Respond clearly with item names.
- If customer asks general menu questions ("menu batao", "kya kya hai", "what do you have?"):
  ONLY list item names or categories. DO NOT mention quantities or prices! NEVER say "1 Chicken Karahi price 1800". Just say: "Hamare paas Chicken Karahi, Mutton Karahi, Biryani, Burgers, Naan aur Drinks available hain."
- If customer EXPLICITLY asks for the price of an item ("Chicken Karahi kitne ki hai?", "pepsi ka rate kya hai?"):
  ONLY THEN tell them the exact price from the menu (e.g., "Chicken Karahi 1800 rupaye ki hai, aur Pepsi 80 rupaye ki hai.").
- If customer asks about PORTIONS / MODIFICATIONS ("karahi mein kitna gosht hota hai", "mirch kam ho sakti hai", "half plate milegi?"):
  Explain portions or available modifications (e.g., "Ji bilkul, bina mirch, zyada teekha, aur half portion ki option available hai.").
- If customer asks about AVAILABILITY of a specific item ("biryani hai?", "burger milega?"):
  Check AVAILABLE MENU ITEMS. If present: "Ji bilkul, [item] available hai. Kitna chahiye?" If not present: "Sorry, yeh item hamare menu mein nahi hai."
- GENERAL RULE: NEVER say "maaf kijiye ga mujhe samajh nahi aaya" or claim you don't understand when a customer asks about food, drinks, menu, prices, or categories! Always check the AVAILABLE MENU ITEMS list and answer intelligently!

CONFIRMATION TIMEOUT:
- If input is exactly "CONFIRMATION_TIMEOUT":
  This means 10 seconds passed with no customer response after confirmation prompt.
  Respond: "Lagta hai aap wahan nahi hain. Agar order karna chahein to dobara Start Ordering dabayein."
  Set next_state to "SLEEPING"
  Set action to "session_timeout"
  Do NOT commit the order to kitchen.

ORDER CONFIRM STATE:
- When state is ORDER_CONFIRM, read back the COMPLETE order with each item name, quantity, and price on a separate line.
  End with total: "Kul bill: PKR {order_total}. Kya yeh sahi hai?"
- If customer says yes/haan/bilkul/confirm/theek hai/sahi hai:
  Set next_state to "SLEEPING"
  Set action to "send_to_kitchen"
  Respond: "Aap ke order karne ka shukriya! Apna bill POS screen se receive kar lein."
- If customer says no/nahi/galat/change/ghalat:
  Set next_state to "ADD_MORE"
  Set action to "none"
  Respond: "Theek hai, kya change karna chahenge?"
- "CONFIRMATION_TIMEOUT" input always triggers session_timeout action.

ENTIRE ORDER CANCELLATION (works in any state except SLEEPING):
- If customer explicitly asks to cancel the ENTIRE order (e.g., "cancel sab", "sab hatao", "poora order cancel kardo", "naya order", or standalone "cancel order"):
  Clear current_order to empty list
  Set order_total to 0
  Set next_state to "SLEEPING"
  Set action to "order_cancelled"
  Respond: "Order cancel kar diya gaya hai."
- IMPORTANT: If the customer says "[item name] cancel kardo" or "[item name] cancel" (e.g., "Chicken karahi cancel krdo", "Burger cancel kar do", "ek naan cancel karo"), do NOT cancel the entire order! Follow Rule 11 (ITEM REMOVAL) instead!

MULTI-ITEM RULES:
10. Customer may name multiple items in one utterance: "ek karahi aur do naan"
    - Parse ALL items from the utterance.
    - Process them in order: if any item needs disambiguation (e.g., karahi variant), \
      handle that first before moving to the next item.
    - If ALL items have clear quantities and no ambiguity, add ALL to current_order in one response, \
      then transition to ADD_MORE.
    - Never skip an item because it appears later in the utterance.

ORDER MODIFICATION RULES:
11. ITEM REMOVAL: "[item] cancel kardo" / "[item] cancel krdo" / "[item] cancel kar do" / "remove [item]" / "hatao [item]" / "[item] nahi chahiye" / "woh wala nahi chahiye" \
    → Remove ONLY that specific item from current_order. Keep all other items intact! Set action to "none". Confirm which item was removed and read back the remaining order.
12. ITEM REPLACEMENT: "change karo [item] ko [new item]" / "[item] ki jagah [new item] kardo" → Replace item in current_order with the new item. Confirm.
13. ENTIRE ORDER CLEARING: "cancel sab" / "sab hatao" / "poora cancel" / "naya order" \
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
  "current_order": [
    {{
      "canonical_name": "Item Name",
      "quantity": 1,
      "unit_price": 850,
      "line_total": 850,
      "modifications": [],
      "special_note": ""
    }}
  ],
  "order_total": 850,
  "action": "none"
}}

Respond only with a JSON object.
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
        self.menu = self._load_menu()
        self.menu_data = self.menu
        self.menu_string = self._build_compact_menu()

        # Init Groq client (reload .env with override=True to catch updated keys dynamically)
        load_dotenv(override=True)
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set in environment")
        self.groq_client = Groq(api_key=api_key)

    def _load_menu(self) -> dict:
        try:
            from database.supabase_client import get_supabase
            db = get_supabase()
            result = db.table("menu_items") \
                .select("*") \
                .eq("available", True) \
                .execute()
            if result.data:
                print(f"[MENU] Loaded {len(result.data)} items from Supabase", flush=True)
                return {"items": result.data, "source": "supabase"}
        except Exception as e:
            print(f"[MENU] Supabase fallback: {e}", flush=True)
        
        menu_path = Path(__file__).parent / "data" / "menu.json"
        if not menu_path.exists():
            menu_path = Path(__file__).parent.parent / "backend" / "data" / "menu.json"
        with open(menu_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data

    def _build_compact_menu(self) -> str:
        lines = ["AVAILABLE MENU ITEMS (ONLY these items exist — no others):"]
        items_list = []
        if self.menu_data.get("source") == "supabase":
            items_list = self.menu_data.get("items", [])
        else:
            for cat in self.menu_data.get("categories", []):
                for it in cat.get("items", []):
                    it_copy = dict(it)
                    it_copy["category"] = cat.get("name", "Main Course")
                    items_list.append(it_copy)
                
        for item in items_list:
            if item.get("available", True):
                aliases_list = item.get("aliases") or []
                if isinstance(aliases_list, str):
                    try:
                        aliases_list = json.loads(aliases_list)
                    except Exception:
                        aliases_list = [aliases_list]
                aliases = ", ".join(aliases_list)
                cat_name = item.get("category", "Main Course")
                lines.append(
                    f"CATEGORY: {cat_name} | "
                    f"NAME: {item['canonical_name']} | "
                    f"PRICE: PKR {item['price']} | "
                    f"ALIASES: {aliases}"
                )
        return "\n".join(lines)

    def _validate_order_items(self, items: list) -> list:
        valid_items = {}
        items_list = []
        if self.menu_data.get("source") == "supabase":
            items_list = self.menu_data.get("items", [])
        else:
            for cat in self.menu_data.get("categories", []):
                items_list.extend(cat.get("items", []))
                
        for item in items_list:
            valid_items[item["canonical_name"].lower()] = item
                
        validated = []
        if not isinstance(items, list):
            return []
            
        for order_item in items:
            if not isinstance(order_item, dict):
                continue
            name = (order_item.get("canonical_name") or order_item.get("name") or "").lower()
            if not name:
                continue
            if name in valid_items:
                canonical_item = valid_items[name]
                order_item["canonical_name"] = canonical_item["canonical_name"]
                order_item["name"] = canonical_item["canonical_name"]
                order_item["unit_price"] = canonical_item["price"]
                order_item["price"] = canonical_item["price"]
                try:
                    qty = int(order_item.get("quantity") or order_item.get("qty") or 1)
                except Exception:
                    qty = 1
                order_item["quantity"] = qty
                order_item["qty"] = qty
                order_item["line_total"] = canonical_item["price"] * qty
                order_item["modifications"] = self._validate_modifications(order_item.get("modifications", []))
                if "special_note" not in order_item:
                    order_item["special_note"] = ""
                validated.append(order_item)
            else:
                best_match = None
                best_ratio = 0.0
                for valid_name, canonical_item in valid_items.items():
                    ratio = SequenceMatcher(None, name, valid_name).ratio()
                    if ratio > best_ratio:
                        best_ratio = ratio
                        best_match = canonical_item
                if best_ratio >= 0.8 and best_match:
                    order_item["canonical_name"] = best_match["canonical_name"]
                    order_item["name"] = best_match["canonical_name"]
                    order_item["unit_price"] = best_match["price"]
                    order_item["price"] = best_match["price"]
                    try:
                        qty = int(order_item.get("quantity") or order_item.get("qty") or 1)
                    except Exception:
                        qty = 1
                    order_item["quantity"] = qty
                    order_item["qty"] = qty
                    order_item["line_total"] = best_match["price"] * qty
                    order_item["modifications"] = self._validate_modifications(order_item.get("modifications", []))
                    if "special_note" not in order_item:
                        order_item["special_note"] = ""
                    validated.append(order_item)
                else:
                    print(f"[HALLUCINATION BLOCKED] Removing invalid menu item: {order_item.get('canonical_name') or order_item.get('name')}", flush=True)
        return validated

    def _validate_modifications(self, modifications: list) -> list:
        """
        Ensures modifications have required fields.
        Fills missing fields with safe defaults.
        Never removes a modification — always preserves customer intent.
        """
        valid_types = {"remove", "add", "substitute", "preparation", "spice"}
        cleaned = []
        if not isinstance(modifications, list):
            return cleaned
        for mod in modifications:
            if not isinstance(mod, dict):
                continue
            mod_type = mod.get("type", "preparation")
            if mod_type not in valid_types:
                mod_type = "preparation"
            cleaned.append({
                "type": mod_type,
                "ingredient": str(mod.get("ingredient", "")),
                "display": str(mod.get("display", mod.get("ingredient", "Special request"))),
                "urdu_display": str(mod.get("urdu_display", mod.get("display", ""))),
            })
        return cleaned

    def reset(self):
        self.state = "SLEEPING"
        self.current_order = []
        self.order_total = 0
        self.history = []
        self.accumulated_interim = ""
        self.session_id = str(uuid.uuid4())

    def _parse_llm_response(self, raw: str) -> dict:
        """
        Parses LLM response to JSON.
        Handles edge cases: markdown fences, XML tags, leading text.
        Returns safe fallback dict if parsing fails entirely.
        """
        if not raw or not raw.strip():
            return self._fallback_response("Empty response from LLM")
        
        text = raw.strip()
        
        # Strip markdown code fences (```json ... ``` or ``` ... ```)
        if text.startswith("```"):
            lines = text.split("\n")
            # Remove first line (```json or ```) and last line (```)
            text = "\n".join(lines[1:-1]).strip()
        
        # Strip XML-like function call wrappers
        # Groq sometimes wraps JSON in <function_calls>...</function_calls>
        xml_match = re.search(r'\{.*\}', text, re.DOTALL)
        if xml_match:
            text = xml_match.group(0)
        
        try:
            result = json.loads(text)
            return result
        except json.JSONDecodeError as e:
            print(f"[JSON PARSE FAILED] Error: {e}", flush=True)
            print(f"[JSON PARSE FAILED] Raw: {raw[:200]}", flush=True)
            
            # Log to file for debugging
            os.makedirs("logs", exist_ok=True)
            with open("logs/parse_failures.log", "a", encoding="utf-8") as f:
                f.write(f"{datetime.now().isoformat()} | ERROR: {e} | RAW: {raw[:300]}\n")
            
            return self._fallback_response(f"JSON parse failed: {e}")

    def _fallback_response(self, reason: str) -> dict:
        """
        Returns a safe fallback that keeps the conversation going
        without losing order state.
        """
        print(f"[FALLBACK] Reason: {reason}", flush=True)
        return {
            "response_text": "Thora sa masla hua. Kya aap dobara keh sakte hain?",
            "next_state": self.state,       # STAY in current state — do not reset
            "current_order": self.current_order,  # KEEP existing order
            "order_total": self.order_total,
            "action": "none",
        }

    def _get_fallback_response(self) -> Dict[str, Any]:
        return self._fallback_response("legacy call")

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

        if user_input_clean == "CONFIRMATION_TIMEOUT":
            resp_text = "Lagta hai aap wahan nahi hain. Agar order karna chahein to dobara Start Ordering dabayein."
            res = {
                "response_text": resp_text,
                "state": "SLEEPING",
                "next_state": "SLEEPING",
                "current_order": self.current_order,
                "order_total": self.order_total,
                "action": "session_timeout",
            }
            self.reset()
            return res

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

        user_lower = user_input_clean.strip().lower()
        # Only cancel the entire order explicitly if the user says "cancel sab", "poora cancel", "naya order", "sab hatao"
        # OR if they say a standalone general cancel phrase without naming a menu item.
        standalone_cancel_phrases = ["cancel", "cancel order", "order cancel", "cancel kardo", "cancel kar do", "cancel krdo", "order cancel kardo", "order cancel krdo", "order cancel kar do", "poora order cancel"]
        if any(cmd in user_lower for cmd in ["cancel sab", "sab hatao", "poora cancel", "naya order"]) or (user_lower in standalone_cancel_phrases and self.state != "SLEEPING"):
            self.current_order = []
            self.order_total = 0
            self.state = "SLEEPING"
            resp_text = "Order cancel kar diya gaya hai."
            self.reset()
            return {
                "response_text": resp_text,
                "state": "SLEEPING",
                "next_state": "SLEEPING",
                "current_order": [],
                "order_total": 0,
                "action": "order_cancelled",
            }

        # Build system prompt
        sys_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            current_state=self.state,
            current_order=json.dumps(self.current_order, ensure_ascii=False),
            order_total=self.order_total,
            menu_string=self.menu_string,
        )

        # Cap history at last 10 turns
        messages = [{"role": "system", "content": sys_prompt}]
        messages.extend(self.history[-10:])
        messages.append({"role": "user", "content": user_input_clean})

        print(
            f"[LLM CALL] state={self.state} "
            f"history_turns={len(self.history)} "
            f"model={os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')}",
            flush=True
        )
        try:
            completion = self.groq_client.chat.completions.create(
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                messages=messages,
                temperature=0.1,
                top_p=0.9,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            raw_content = completion.choices[0].message.content or ""
            data = self._parse_llm_response(raw_content)

            response_text = data.get("response_text", "")
            next_state = data.get("next_state", self.state)
            current_order = data.get("current_order", self.current_order)
            current_order = self._validate_order_items(current_order)
            for item in current_order:
                item["modifications"] = self._validate_modifications(
                    item.get("modifications", [])
                )
                if "special_note" not in item:
                    item["special_note"] = ""
            order_total = sum(item.get("line_total", 0) for item in current_order)
            action = data.get("action", "none")

            # Validate state transition
            if next_state in VALID_STATES:
                self.state = next_state
            else:
                next_state = self.state

            self.current_order = current_order
            self.order_total = order_total

            # Update conversation history
            self.history.append({"role": "user", "content": user_input_clean})
            self.history.append({"role": "assistant", "content": response_text})
            # Trim to last 10 messages (5 turns × 2)
            if len(self.history) > 10:
                self.history = self.history[-10:]

            if action in ["send_to_kitchen", "session_timeout", "order_cancelled"]:
                final_response = {
                    "response_text": response_text,
                    "state": "SLEEPING",
                    "next_state": "SLEEPING",
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
            error_str = str(e)
            if "429" in error_str or "rate_limit" in error_str.lower():
                print(f"[RATE LIMIT] Groq rate limit hit: {e}", flush=True)
                print(f"[RATE LIMIT] Consider reducing max_tokens or switching to paid tier", flush=True)
            else:
                print(f"[ERROR] LLM call failed: {e}", flush=True)
            return self._get_fallback_response()

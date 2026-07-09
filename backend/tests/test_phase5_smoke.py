"""
Phase 5 Smoke Tests
Run with: cd backend && python -m pytest tests/test_phase5_smoke.py -v
All 7 tests must pass before proceeding.
"""

import os
import sys
import uuid
import pytest

# Ensure backend root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import generate_session_id, calc_line_total
from conversation_manager import ConversationManager
from database.supabase_client import get_supabase


def test_generate_session_id_format():
    """Test 1: generate_session_id() format"""
    sid = generate_session_id()
    assert isinstance(sid, str)
    assert "-" in sid
    parts = sid.split("-")
    assert len(parts) >= 2
    # Date part YYYYMMDD-HHMM has format length check
    assert len(parts[-1]) == 4


def test_calc_line_total_weight_quantities():
    """Test 2: calc_line_total handles weight quantities"""
    assert calc_line_total(850, "1 kg") == 850
    assert calc_line_total(850, "2 kg") == 1700
    assert calc_line_total(850, "0.5 kg") == 425
    assert calc_line_total(100, "3") == 300


def test_calc_line_total_bad_input():
    """Test 3: calc_line_total handles bad input without crashing"""
    assert calc_line_total(850, "invalid") == 850
    assert calc_line_total(850, None) == 850
    assert calc_line_total(850, "") == 850


def test_supabase_commit_writes_and_returns_uuid():
    """Test 4: Supabase commit writes and returns UUID"""
    test_session = "smoke_test_" + str(uuid.uuid4())[:8]
    db = get_supabase()
    result = db.table("orders").insert({
        "items": [{"canonical_name": "Test Item", "quantity": "1", "unit_price": 100, "line_total": 100}],
        "total_amount": 100,
        "status": "pending",
        "session_id": test_session,
    }).execute()
    assert result.data is not None
    assert len(result.data) > 0
    order_id = result.data[0]["id"]
    assert len(order_id) == 36  # UUID format
    # Cleanup
    db.table("orders").delete().eq("session_id", test_session).execute()


def test_cm_handles_confirmation_timeout():
    """Test 5: ConversationManager handles CONFIRMATION_TIMEOUT"""
    cm = ConversationManager()
    cm.state = "ORDER_CONFIRM"
    cm.current_order = [{"canonical_name": "Chicken Karahi", "quantity": "1 kg", "unit_price": 850}]
    result = cm.process_input("CONFIRMATION_TIMEOUT")
    assert result["next_state"] == "SLEEPING"
    assert result["action"] == "session_timeout"


def test_cm_handles_order_cancellation():
    """Test 6: ConversationManager handles order cancellation"""
    cm = ConversationManager()
    cm.state = "ADD_MORE"
    cm.current_order = [{"canonical_name": "Chicken Karahi", "quantity": "1 kg", "unit_price": 850}]
    result = cm.process_input("cancel sab")
    assert result["current_order"] == []
    assert result["next_state"] == "SLEEPING"
    assert result["action"] == "order_cancelled"


def test_cm_order_confirm_to_confirmed():
    """Test 7: ConversationManager ORDER_CONFIRM -> confirmed"""
    cm = ConversationManager()
    cm.state = "ORDER_CONFIRM"
    cm.current_order = [{"canonical_name": "Chicken Karahi", "quantity": "1 kg", "unit_price": 850}]
    cm.order_total = 850
    result = cm.process_input("haan theek hai")
    assert result["action"] == "send_to_kitchen"
    assert result["next_state"] == "SLEEPING"

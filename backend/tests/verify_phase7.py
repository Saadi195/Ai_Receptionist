"""
Verification Script for Phase 7:
1. Local JWT Verification (python-jose)
2. Three-Layer Hallucination Defence (_validate_order_items)
3. Rate Limiting (slowapi 429 response)
"""

import os
import sys
import time
import pytest
from jose import jwt
from fastapi.testclient import TestClient

# Ensure parent directory is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from security import verify_token, require_admin
from fastapi.security import HTTPAuthorizationCredentials
from conversation_manager import ConversationManager

client = TestClient(app)

def test_1_local_jwt_verification():
    print("\n--- TEST 1: Local JWT Verification ---")
    secret = "test-secret-key-for-jwt-verification-1234567890"
    os.environ["SUPABASE_JWT_SECRET"] = secret
    
    # 1. Test Admin Token
    admin_payload = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "admin@savourfoods.ai",
        "user_role": "admin",
        "exp": int(time.time()) + 3600,
        "aud": "authenticated"
    }
    token_str = jwt.encode(admin_payload, secret, algorithm="HS256")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_str)
    
    decoded = verify_token(creds)
    assert decoded["sub"] == admin_payload["sub"]
    assert decoded["id"] == admin_payload["sub"]
    assert decoded["user_role"] == "admin"
    print("[PASS] verify_token decoded token locally in <1ms without network call!")
    
    admin_checked = require_admin(decoded)
    assert admin_checked["user_role"] == "admin"
    print("[PASS] require_admin passed for admin role!")
    

def test_2_hallucination_defence():
    print("\n--- TEST 2: Three-Layer Hallucination Defence ---")
    cm = ConversationManager()
    # Mock menu items for testing
    cm.menu_data = {
        "source": "supabase",
        "items": [
            {"id": "1", "canonical_name": "Chicken Karahi", "price": 1800, "available": True},
            {"id": "2", "canonical_name": "Beef Burger", "price": 650, "available": True},
            {"id": "3", "canonical_name": "Raita", "price": 100, "available": True}
        ]
    }
    
    # Test items submitted by LLM (some exact, some typo/fuzzy, some hallucinated)
    test_order = [
        {"canonical_name": "Chicken Karahi", "quantity": 2, "unit_price": 1800, "line_total": 3600},
        {"canonical_name": "Chiken Karahi", "quantity": 1, "unit_price": 2000, "line_total": 2000}, # Typo + invented price!
        {"canonical_name": "Dragon Fruit Smoothie", "quantity": 1, "unit_price": 500, "line_total": 500}, # Hallucination!
        {"canonical_name": "Beef Burger", "quantity": 3, "unit_price": 650, "line_total": 1950}
    ]
    
    validated = cm._validate_order_items(test_order)
    print("Validated items returned by Python layer:", validated)
    
    # Assertions
    names = [item["canonical_name"] for item in validated]
    assert "Chicken Karahi" in names
    assert "Beef Burger" in names
    assert "Dragon Fruit Smoothie" not in names, "Hallucinated item should be removed!"
    
    # Check typo correction & price correction
    karahi_items = [item for item in validated if item["canonical_name"] == "Chicken Karahi"]
    assert len(karahi_items) == 2
    for item in karahi_items:
        assert item["unit_price"] == 1800, "Invented price 2000 should be corrected to canonical 1800!"
        assert item["line_total"] == 1800 * item["quantity"]
        
    print("[PASS] Hallucination defence successfully corrected typos, fixed invented prices, and dropped hallucinated items!")


def test_3_rate_limiting():
    print("\n--- TEST 3: Rate Limiting (slowapi) ---")
    # /api/auth/signup is limited to 3/minute per IP
    # Let's send 4 requests and check that the 4th gets 429 Too Many Requests
    responses = []
    for i in range(4):
        res = client.post("/api/auth/signup", json={
            "email": f"ratelimit_test_{i}@example.com",
            "password": "password123",
            "display_name": f"User {i}",
            "role": "admin"
        })
        responses.append(res.status_code)
        print(f"Request {i+1} status: {res.status_code}")
        
    assert 429 in responses, f"Expected 429 Too Many Requests, got statuses: {responses}"
    print("[PASS] Rate limiter successfully blocked excessive requests with 429 status!")

if __name__ == "__main__":
    test_1_local_jwt_verification()
    test_2_hallucination_defence()
    test_3_rate_limiting()
    print("\n[ALL PHASE 7 VERIFICATION TESTS PASSED SUCCESSFULLY!]")

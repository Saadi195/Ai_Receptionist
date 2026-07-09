import os
import sys
import uuid
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

# Add parent directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))
from main import app
from database.supabase_client import get_supabase
from conversation_manager import ConversationManager

client = TestClient(app)

# Test credentials
ADMIN_EMAIL = f"testadmin_{uuid.uuid4().hex[:6]}@savourfoods.ai"
ADMIN_PASSWORD = "TestPassword123!"
ADMIN_NAME = "Test Admin"


@pytest.fixture(scope="module", autouse=True)
def cleanup_test_users():
    db = get_supabase()
    # Before tests: remove any existing admin so Test 1 can create an admin
    try:
        admins = db.table("user_profiles").select("id").eq("role", "admin").execute()
        if admins.data:
            for row in admins.data:
                try:
                    db.auth.admin.delete_user(row["id"])
                except Exception:
                    pass
                try:
                    db.table("user_profiles").delete().eq("id", row["id"]).execute()
                except Exception:
                    pass
    except Exception as e:
        print(f"[CLEANUP ERROR]: {e}")
    
    yield
    
    # After tests: remove test users created during this run and restore permanent admin account
    try:
        for email in [ADMIN_EMAIL]:
            profiles = db.table("user_profiles").select("id").eq("display_name", ADMIN_NAME).execute()
            if profiles.data:
                for row in profiles.data:
                    try:
                        db.auth.admin.delete_user(row["id"])
                    except Exception:
                        pass
                    try:
                        db.table("user_profiles").delete().eq("id", row["id"]).execute()
                    except Exception:
                        pass
        # Always restore permanent admin account so credentials never change
        try:
            res = db.auth.admin.create_user({
                "email": "admin@savourfoods.ai",
                "password": "SavourAdmin123!",
                "email_confirm": True,
                "user_metadata": {"display_name": "Savour Admin", "role": "admin"}
            })
            if res.user:
                db.table("user_profiles").upsert({
                    "id": res.user.id,
                    "role": "admin",
                    "display_name": "Savour Admin"
                }).execute()
        except Exception:
            pass
    except Exception:
        pass

def test_01_signup_admin():
    """Test 1: Signup creates admin account successfully"""
    res = client.post("/api/auth/signup", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "display_name": ADMIN_NAME,
        "role": "admin"
    })
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert "user_id" in data
    assert data["role"] == "admin"
    
    # Verify user_profiles row created
    db = get_supabase()
    profile = db.table("user_profiles").select("*").eq("id", data["user_id"]).single().execute()
    assert profile.data is not None
    assert profile.data["role"] == "admin"

def test_02_second_admin_signup_returns_409():
    """Test 2: Second admin signup returns 409"""
    res = client.post("/api/auth/signup", json={
        "email": f"secondadmin_{uuid.uuid4().hex[:4]}@savourfoods.ai",
        "password": "TestPassword123!",
        "display_name": "Second Admin",
        "role": "admin"
    })
    assert res.status_code == 409, f"Expected 409, got {res.status_code}: {res.text}"
    assert "admin account already exists" in res.json().get("detail", "").lower()


def test_04_login_returns_token_and_role():
    """Test 4: Login returns access token and role"""
    res = client.post("/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "admin"

def test_05_menu_route_requires_auth():
    """Test 5: Menu route requires auth for write operations"""
    db = get_supabase()
    item = db.table("menu_items").select("id").limit(1).execute()
    item_id = item.data[0]["id"] if item.data else "00000000-0000-0000-0000-000000000000"
    
    res = client.patch(f"/api/menu/{item_id}/availability", json={"available": True})
    assert res.status_code in (401, 422), f"Expected 401 or 422, got {res.status_code}"

def test_06_menu_route_with_admin_token_returns_200():
    """Test 6: Menu route with valid admin token returns 200"""
    login_res = client.post("/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    token = login_res.json()["access_token"]
    
    db = get_supabase()
    item = db.table("menu_items").select("id, available").limit(1).execute()
    assert item.data and len(item.data) > 0, "No menu items found in Supabase"
    item_id = item.data[0]["id"]
    current_avail = item.data[0].get("available", True)
    
    res = client.patch(
        f"/api/menu/{item_id}/availability",
        json={"available": not current_avail},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    assert res.json()["available"] == (not current_avail)
    
    # Revert availability
    client.patch(
        f"/api/menu/{item_id}/availability",
        json={"available": current_avail},
        headers={"Authorization": f"Bearer {token}"}
    )

def test_08_order_status_update_works_for_admin():
    """Test 8: Order status update works for admin token"""
    login_res = client.post("/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    token = login_res.json()["access_token"]
    
    db = get_supabase()
    # Create temporary order in pending status
    order_res = db.table("orders").insert({
        "session_id": f"test-session-{uuid.uuid4()}",
        "status": "pending",
        "total_amount": 500,
        "items": [{"name": "Test Item", "qty": "1", "unit_price": 500, "line_total": 500}]
    }).execute()
    assert order_res.data and len(order_res.data) > 0
    order_id = order_res.data[0]["id"]
    
    try:
        res = client.patch(
            f"/api/orders/{order_id}/status",
            json={"status": "preparing"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        assert res.json()["status"] == "preparing"
    finally:
        try:
            db.table("orders").delete().eq("id", order_id).execute()
        except Exception:
            pass

def test_09_conversation_manager_loads_menu_from_supabase():
    """Test 9: ConversationManager loads menu from Supabase"""
    cm = ConversationManager()
    assert cm.menu.get("source") == "supabase", f"Expected source 'supabase', got {cm.menu.get('source')}"
    assert "items" in cm.menu and len(cm.menu["items"]) > 0, "No items loaded in ConversationManager"

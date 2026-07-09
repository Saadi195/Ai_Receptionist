from jose import jwt, JWTError
from fastapi import Depends, HTTPException, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
from typing import Dict, Any

bearer_scheme = HTTPBearer()

def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
) -> Dict[str, Any]:
    """
    Verifies Supabase JWT locally using JWT secret.
    No network call — runs in ~1ms vs ~600ms for remote verification.
    
    Returns decoded payload containing:
    - sub: user UUID
    - email: user email  
    - user_role: 'admin' (from Custom Access Token Hook)
    - exp: expiry timestamp
    """
    token = credentials.credentials
    secret = os.getenv("SUPABASE_JWT_SECRET")
    
    if secret:
        try:
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated"
            )
            if "sub" in payload and "id" not in payload:
                payload["id"] = payload["sub"]
            return payload
        except JWTError as e:
            print(f"[AUTH ERROR] Local JWT verification failed: {e}. Falling back to remote verification.", flush=True)
            return _verify_remote(token)
    else:
        return _verify_remote(token)

def _verify_remote(token: str) -> Dict[str, Any]:
    """Fallback: verify token by querying Supabase auth endpoint via SDK."""
    try:
        from database.supabase_client import get_supabase
        db = get_supabase()
        res = db.auth.get_user(token)
        if not res or not res.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token.")
        
        user_data = {
            "sub": res.user.id,
            "id": res.user.id,
            "email": res.user.email,
            "role": res.user.role,
        }
        if res.user.user_metadata:
            user_data["user_role"] = res.user.user_metadata.get("user_role", "")
        return user_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Remote authentication failed: {e}")

def _get_role_with_fallback(payload: Dict[str, Any]) -> str:
    """Helper to get user_role from JWT claims, with graceful DB fallback if hook not enabled."""
    role = payload.get("user_role")
    if role == "authenticated" or not role:
        role = payload.get("role")
    if role == "authenticated" or not role:
        # Fallback if Custom Access Token Hook is not enabled or an older JWT is used
        try:
            from database.supabase_client import get_supabase
            db = get_supabase()
            user_id = payload.get("sub") or payload.get("id")
            if user_id:
                res = db.table("user_profiles").select("role").eq("id", user_id).single().execute()
                if res.data:
                    role = res.data.get("role")
                    payload["user_role"] = role
                    payload["role"] = role
        except Exception:
            pass
    return role or ""

def require_admin(payload: Dict[str, Any] = Depends(verify_token)) -> Dict[str, Any]:
    """
    Extends verify_token — additionally checks user_role == 'admin'.
    Use as a FastAPI dependency on admin-only routes.
    """
    role = _get_role_with_fallback(payload)
    if role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required."
        )
    return payload

def require_staff_or_admin(payload: Dict[str, Any] = Depends(verify_token)) -> Dict[str, Any]:
    """
    Deprecated: Previously allowed both staff and admin. Now strictly enforces admin access.
    """
    return require_admin(payload)

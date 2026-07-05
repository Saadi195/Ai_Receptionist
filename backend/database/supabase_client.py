from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

_client: Client | None = None

def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
        if not url or not key:
            print("[WARNING] Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_SECRET_KEY found in environment!", flush=True)
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) must be set in backend/.env"
            )
        _client = create_client(url, key)
    return _client

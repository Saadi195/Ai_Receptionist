from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

_client: Client | None = None

def get_supabase() -> Client:
    global _client
    if _client is None:
        load_dotenv(override=True)
        url = os.getenv("SUPABASE_URL")
        key = (
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_ANON_KEY")
            or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        )
        if not url or not key:
            print("[WARNING] Supabase keys not found in environment!", flush=True)
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY (or SERVICE_ROLE_KEY / SECRET_KEY / ANON_KEY) must be set in backend/.env"
            )
        _client = create_client(url, key)
    return _client

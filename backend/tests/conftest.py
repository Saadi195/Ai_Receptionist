"""
Pytest configuration for backend tests.
Adds the backend root to sys.path so modules like conversation_manager,
tts_service, and database.supabase_client can be imported directly.
"""
import sys
import os

# Add backend root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env for all tests
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import os
import sys
from dotenv import load_dotenv
from groq import Groq

# Load .env from parent directory or current environment
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"), override=True)
load_dotenv(override=True)

def verify_groq():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("[ERROR] GROQ_API_KEY is not set.")
        return False

    print("[GROQ] Sending test request to Groq API (model=llama-3.3-70b-versatile)...")
    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "user", "content": "Say 'Groq is working!' and nothing else."}
            ],
            temperature=0.2,
            max_tokens=50,
        )
        response_text = completion.choices[0].message.content or ""
        print("Status: 200")
        print("Response:", response_text.strip())
        return True
    except Exception as e:
        print(f"[ERROR] Groq request failed: {e}")
        return False

if __name__ == "__main__":
    verify_groq()

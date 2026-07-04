from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Restaurant AI Ordering API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "success", "message": "Restaurant AI Ordering API is running"}

@app.get("/health")
def health_check():
    return {"status": "success"}

@app.get("/deepgram-test")
def deepgram_test():
    # Placeholder for Deepgram test
    return {"status": "success"}

@app.get("/groq-test")
def groq_test():
    # Placeholder for Groq test
    return {"status": "success"}

@app.get("/elevenlabs-test")
def elevenlabs_test():
    # Placeholder for ElevenLabs test
    return {"status": "success"}

@app.get("/supabase-test")
def supabase_test():
    # Placeholder for Supabase test
    return {"status": "success"}

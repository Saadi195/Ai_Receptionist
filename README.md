# Restaurant AI Ordering Project

## Project Overview
This project is an AI-powered voice ordering system for restaurants. It uses modern voice AI (Deepgram for STT, ElevenLabs for TTS) and LLM (Groq Llama 3) to act as a voice assistant taking orders.

## Tech Stack
- **Frontend**: Next.js 15, Tailwind CSS, Framer Motion
- **Backend**: FastAPI, SQLAlchemy
- **Database**: Supabase (PostgreSQL)
- **AI Services**: Deepgram (STT), Groq (LLM), ElevenLabs (TTS)

## Folder Structure
- `/frontend`: Next.js Customer Interface and Dashboard.
- `/backend`: FastAPI Python Backend.
- `/shared`: Shared Types.
- `/docs`: Documentation.
- `/assets`: Images and models.
- `/prompts`: AI prompts.

## Local Setup

### 1. Prerequisites
- Node.js LTS
- Python 3.12
- Supabase account
- Deepgram account
- Groq account
- ElevenLabs account

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Required API Keys
See `.env.example` in the root and `backend/.env` for all required keys. You will need to populate these with your own keys before the app will function fully.

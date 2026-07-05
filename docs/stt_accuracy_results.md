# STT Accuracy Test Results

**Date:** 2026-07-05  
**Tested by:** Claude Code Agent & Developer  
**Audio conditions:** Quiet room + restaurant ambient noise at 65 dB  
**Total samples:** 30 (15 quiet + 15 noisy)  
**Pass threshold:** 85% accuracy on both conditions  

## Results

| Model | Quiet | Noisy | Decision |
|---|---|---|---|
| groq_whisper_turbo | 40% | 40% | DO NOT PROCEED |
| deepgram_nova3_multi | 93% | 93% | PROCEED |
| deepgram_nova3_urdu | 0% | 0% | DO NOT PROCEED |

## Winning Model

**deepgram_nova3_multi** (Deepgram Nova-3 Multilingual with keyterm prompting)

## Notes

- **deepgram_nova3_multi** performed exceptionally well, achieving 93% accuracy on both quiet and noisy conditions (14 out of 15 samples passed in each condition). The only missed sample in both conditions was sample 14, where the speaker said "Mutton Biryani" instead of the expected menu item "Mutton Karahi".
- **groq_whisper_turbo** scored 40% in both conditions, struggling with code-switched Urdu-English menu item names and transliteration consistency.
- **deepgram_nova3_urdu** scored 0% on English menu item verification because it transcribed all speech exclusively into Urdu script (e.g., "ایک چکن کڑاہی دینا"), whereas the test suite validates against canonical English script menu names.

## Action Taken

Added `STT_MODEL_WINNER="deepgram_nova3_multi"` to `backend/.env`.

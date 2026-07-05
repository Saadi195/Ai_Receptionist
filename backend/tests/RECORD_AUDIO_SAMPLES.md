# Audio Sample Recording Instructions

## Before running any tests, record these 30 audio files.

### Required format
- File format: .wav
- Sample rate: 16000 Hz mono
- Naming: quiet_01.wav through quiet_15.wav and noisy_01.wav through noisy_15.wav
- Save to: backend/tests/audio_samples/

### Convert from phone recording
ffmpeg -i recording.m4a -ar 16000 -ac 1 quiet_01.wav

### Quiet samples (record in a quiet room, 15 files)
quiet_01.wav — "Ek chicken karahi dena"
quiet_02.wav — "Two beef burgers, bina onion ke"
quiet_03.wav — "Mujhe zeera rice chahiye aur ek naan"
quiet_04.wav — "Bhai, one mutton karahi aur teen naan please"
quiet_05.wav — "Chicken biryani, extra raita"
quiet_06.wav — "Ek seekh kebab aur do roti"
quiet_07.wav — "Mango shake aur french fries"
quiet_08.wav — "Dal makhani, medium spicy"
quiet_09.wav — "Aloo gosht aur ek garlic naan"
quiet_10.wav — "Two chicken burgers, no cheese, aur Pepsi"
quiet_11.wav — "Nihari, ek serving, aur do roti"
quiet_12.wav — "Zeera rice, do plates"
quiet_13.wav — "Ek chicken biryani aur do naan"
quiet_14.wav — "Mutton karahi, half portion, bina mirch"
quiet_15.wav — "Mango shake, bina ice"

### Noisy samples (play restaurant ambient noise from speaker while recording)
Record the same 15 phrases as noisy_01.wav through noisy_15.wav
YouTube search: "restaurant kitchen background noise ambient"
Play at 65 dB from a speaker 1 meter away while recording.

### Verify all 30 files exist
ls backend/tests/audio_samples/*.wav | wc -l
# Should output: 30

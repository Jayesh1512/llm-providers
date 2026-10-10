"""Generate the original soundtrack; no samples, external assets, or dependencies."""
import array
import math
import random
import wave
from pathlib import Path

RATE = 44100
DURATION = 30
rng = random.Random(10143)
left = array.array('f', [0.0]) * (RATE * DURATION)
right = array.array('f', [0.0]) * (RATE * DURATION)

def put(start, seconds, synthesizer, gain=1.0, pan=0.0):
    begin = int(start * RATE)
    for n in range(int(seconds * RATE)):
        index = begin + n
        if index >= len(left):
            break
        sample = synthesizer(n / RATE) * gain
        left[index] += sample * (1.0 - max(pan, 0))
        right[index] += sample * (1.0 + min(pan, 0))

def kick(t):
    return math.sin(2 * math.pi * (46 * t + 8 * (1 - math.exp(-t * 28)))) * math.exp(-t * 12)

def hat(t):
    return rng.uniform(-1, 1) * math.exp(-t * 100)

def note(freq, decay=3.8):
    return lambda t: (math.sin(2 * math.pi * freq * t) + 0.15 * math.sin(2 * math.pi * freq * 2 * t)) * (1 - math.exp(-t * 90)) * math.exp(-t * decay)

roots = [110.0, 87.307, 130.813, 97.999]
for beat in range(60):
    at = beat * 0.5
    root = roots[(beat // 8) % 4]
    if beat % 2 == 0:
        put(at, 0.42, kick, 0.33)
    put(at, 0.08, hat, 0.055, -0.20)
    put(at + 0.25, 0.065, hat, 0.025, 0.20)
    if beat % 2 == 0:
        put(at, 0.9, note(root, 5.0), 0.115)
    if beat > 7:
        freq = root * [4, 6, 5, 8][beat % 4]
        put(at + 0.25, 0.68, note(freq, 7.0), 0.075, (-0.35 if beat % 2 else 0.35))
        put(at + 0.50, 0.68, note(freq, 7.0), 0.025, (0.35 if beat % 2 else -0.35))

# Short, tonal transition markers follow the scene cuts.
for at in [4, 8, 14, 19, 24]:
    put(at, 1.5, note(440, 3.0), 0.075, -0.15)
    put(at + 0.08, 1.5, note(660, 3.5), 0.055, 0.15)

output = array.array('h')
for index in range(len(left)):
    t = index / RATE
    fade = min(1.0, t / 0.35, max(0, (30 - t) / 2.0))
    for channel in [left, right]:
        output.append(max(-32767, min(32767, int(math.tanh(channel[index] * 1.25) * fade * 40000))))

target = Path(__file__).resolve().parents[1] / 'film' / 'public' / 'original-score.wav'
with wave.open(str(target), 'wb') as audio:
    audio.setnchannels(2)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes(output.tobytes())
print(target)

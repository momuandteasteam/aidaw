"""Bounded, overlapping Spleeter inference. Model files are installed explicitly."""
import os
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
import tensorflow as tf
tf.config.threading.set_intra_op_parallelism_threads(4)
tf.config.threading.set_inter_op_parallelism_threads(2)
from spleeter.separator import Separator
source, output = sys.argv[1:3]
out = Path(output)
out.mkdir(parents=True, exist_ok=True)
info = sf.info(source)
if info.samplerate != 44100 or info.channels != 2 or not 0 < info.frames <= 44100*1800:
    raise ValueError('Expected stereo 44.1 kHz audio of at most 30 minutes')
names = ['vocals', 'drums', 'bass', 'other']
separator = Separator('spleeter:4stems-16kHz', multiprocess=False)
size, overlap = 44100*10, 44100
step = size-overlap
sums = np.memmap(out/'accumulator.tmp', dtype='float32', mode='w+', shape=(4, info.frames, 2))
weights = np.memmap(out/'weights.tmp', dtype='float32', mode='w+', shape=(info.frames,))
sums[:] = 0
weights[:] = 0
with sf.SoundFile(source) as audio:
    for start in range(0, info.frames, step):
        audio.seek(start)
        block = audio.read(min(size, info.frames-start), dtype='float32', always_2d=True)
        if not np.isfinite(block).all():
            raise ValueError('Non-finite input')
        count = len(block)
        prediction = separator.separate(np.pad(block, ((0,max(0,44100-count)),(0,0))))
        weight = np.ones(count, dtype='float32')
        if start: weight[:min(overlap,count)] = np.linspace(0,1,min(overlap,count),endpoint=False)
        if start+count < info.frames: weight[-overlap:] = np.linspace(1,0,overlap,endpoint=False)
        for index, name in enumerate(names):
            stem = prediction[name][:count]
            if stem.shape != block.shape or not np.isfinite(stem).all():
                raise ValueError('Invalid stem output')
            sums[index,start:start+count] += stem*weight[:,None]
        weights[start:start+count] += weight
        print(f'{min(start+count,info.frames)}/{info.frames}', flush=True)
        if start+count >= info.frames: break
for index,name in enumerate(names):
    with sf.SoundFile(out/f'{name}.wav','w',samplerate=44100,channels=2,subtype='FLOAT') as audio:
        for start in range(0, info.frames, 44100*10):
            end = min(start+44100*10,info.frames)
            audio.write(sums[index,start:end]/np.maximum(weights[start:end,None],1e-8))
del sums, weights
(out/'accumulator.tmp').unlink()
(out/'weights.tmp').unlink()

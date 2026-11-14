"""Conform the launch plates and Blender exposure frames to a 450-frame master."""
import argparse
import subprocess
import wave
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parent.parent
SIZE = (1920, 1080)
FPS = 30
PLATES = [
    ("pad", 17.3, 66, 1),       # upper-stage close-up while the pad is held
    ("pad", 244.2, 34, 2.4),    # ignition illuminates the mobile launcher
    ("pad", 250.8, 35, 2),      # clear the tower
    ("orbit", 373.6, 60, 1.6),  # spent booster pair falling away
    ("orbit", 447.4, 66, 1),    # crew transfer above Earth's limb
]

def score(path):
    rate = 48000
    t = np.arange(15 * rate) / rate
    rng = np.random.default_rng(1969)
    def noise(lo, hi):
        return sosfilt(butter(3, [lo, hi], fs=rate, btype="band", output="sos"),
                       rng.normal(size=t.size))
    def env(times, levels):
        return np.interp(t, times, levels, left=0, right=0)
    launch = env([.4, 1.8, 2.16, 2.28, 2.6, 3.4, 4.42, 4.55, 5.05],
                 [.02, .12, .21, .75, .64, 1, .92, .16, 0])
    burn = env([8.68, 9, 10.9, 11.7, 12.35, 12.63, 12.78],
               [0, .3, .61, .77, .59, .4, 0])
    def impact(at, strength, freq, decay):
        d = np.maximum(0, t-at)
        return strength * (t >= at) * np.exp(-d/decay) * np.sin(2*np.pi*freq*d)
    bed = .024*np.sin(2*np.pi*51*t) + .009*np.sin(2*np.pi*77*t)
    engine = (1.8*noise(24,180) + .29*noise(200,4200) +
              .15*np.sin(2*np.pi*(37*t+.93*t*t)))
    mix = bed + engine*launch + (1.6*noise(30,260)+.29*noise(350,6500))*burn
    for at, strength, freq, decay in [(1.82,.13,81,.17),(2.18,.55,42,.35),
            (4.52,.7,85,.11),(4.59,.25,167,.08),(6.5,.14,128,.14),
            (12.58,.65,54,.23),(12.65,.32,106,.08),(13.27,.18,197,.07),
            (13.82,.17,92,.12),(14.2,.17,82,.09),(14.62,.15,89,.09)]:
        mix += impact(at,strength,freq,decay)
    mix += noise(750,4800)*env([12.58,12.67,13.12,13.75,14.55],[0,.24,.13,.06,0])
    mix += .037*np.sin(2*np.pi*235*t)*env([13.3,13.4,13.78,13.84],[0,1,.7,0])
    air = .065*noise(130,3400)*(launch+burn)
    stereo = np.column_stack([mix+air,mix+np.roll(air,179)])
    stereo = np.tanh(stereo*1.38)*.89*env([0,.16,14.78,15],[0,1,1,0])[:,None]
    with wave.open(str(path),"wb") as wav:
        wav.setparams((2,2,rate,0,"NONE","not compressed"))
        wav.writeframes((stereo*32767).astype("<i2").tobytes())

def landing_frames(directory):
    # Interpolate within individual shots so optical flow never crosses an edit.
    width, height = SIZE
    mx,my = np.meshgrid(np.arange(width,dtype=np.float32),np.arange(height,dtype=np.float32))
    def flow(a,b):
        gray = lambda x: cv2.resize(cv2.cvtColor(x,cv2.COLOR_BGR2GRAY),(640,360))
        v=cv2.calcOpticalFlowFarneback(gray(a),gray(b),None,.5,5,25,4,7,1.5,0)
        return cv2.resize(v,SIZE)*3
    def read(f):
        img=cv2.imread(str(directory / f"frame-{f:04}.jpg"))
        if img is None: raise FileNotFoundError(f)
        return cv2.bilateralFilter(img,5,36,3)
    names=sorted(int(p.stem.split("-")[-1]) for p in directory.glob("frame-*.jpg"))
    for first,last in [(262,339),(340,396),(397,450)]:
        keys=[f for f in names if first<=f<=last]
        if not keys or (keys[0],keys[-1])!=(first,last): raise RuntimeError("Incomplete landing frames")
        a=read(first)
        for i,j in zip(keys,keys[1:]):
            b=read(j)
            forward,reverse=flow(a,b),flow(b,a)
            for f in range(i,j):
                u=(f-i)/(j-i)
                if not u: yield a; continue
                src=cv2.remap(a,mx-forward[:,:,0]*u,my-forward[:,:,1]*u,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
                dst=cv2.remap(b,mx-reverse[:,:,0]*(1-u),my-reverse[:,:,1]*(1-u),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
                yield cv2.addWeighted(src,1-u,dst,u,0)
            a=b
        yield a

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("work", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args=parser.parse_args()
    cv2.setNumThreads(4)
    work=args.work.resolve()
    out=ROOT/"public/cinematics"
    out.mkdir(exist_ok=True)
    run=lambda params: subprocess.run([args.ffmpeg,"-y","-loglevel","error",*map(str,params)],check=True)
    score(work/"flight.wav")
    # Preserve the launch recording's pressure and crackle over the designed LFE.
    run(["-i",work/"flight.wav","-ss","249.5","-t","2.65","-i",work/"pad.mp4",
         "-filter_complex","[1:a]afade=in:d=0.25,afade=out:st=2.12:d=0.53,volume=0.58,adelay=2170|2170,apad[p];[0:a][p]amix=inputs=2:duration=first,volume=2,alimiter=limit=0.94[m]",
         "-map","[m]","-c:a","pcm_s16le",work/"mix.wav"])
    clips=[]
    for i,(name,ss,count,speed) in enumerate(PLATES):
        clip=work/f"cut-{i}.mp4"
        run(["-ss",ss,"-i",work/(name+".mp4"),"-an","-vf",
             f"setpts=PTS/{speed},fps=30,scale=1920:1080:flags=lanczos,setsar=1",
             "-frames:v",count,"-c:v","libx264","-crf","16","-pix_fmt","yuv420p",clip])
        clips.append(clip)
    clip=work/"cut-landing.mp4"
    with subprocess.Popen([args.ffmpeg,"-y","-loglevel","error","-f","rawvideo","-pix_fmt","bgr24",
            "-s","1920x1080","-r","30","-i","-","-an","-c:v","libx264","-crf","16","-pix_fmt","yuv420p",str(clip)],stdin=subprocess.PIPE) as proc:
        for frame in landing_frames(work/"kestrel-frames"): proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait(): raise RuntimeError("Landing encode failed")
    clips.append(clip)
    listing=work/"edit.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in clips),encoding="utf-8")
    master=out/"mission-launch-1080p.mp4"
    run(["-f","concat","-safe","0","-i",listing,"-i",work/"mix.wav","-c:v","copy","-c:a","aac","-b:a","192k","-movflags","+faststart","-t","15",master])
    run(["-i",master,"-vf","scale=1280:720","-c:v","libx264","-crf","22","-c:a","copy","-movflags","+faststart",out/"mission-launch-720p.mp4"])
    run(["-i",master,"-c:v","libvpx-vp9","-row-mt","1","-threads","8","-deadline","realtime","-cpu-used","7","-crf","34","-b:v","0","-c:a","libopus",out/"mission-launch-1080p.webm"])
    run(["-ss","0.75","-i",master,"-frames:v","1",out/"mission-launch-poster.webp"])

if __name__=="__main__": main()

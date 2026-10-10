This four-second video contains a generated test pattern and 440 Hz tone. It is used to verify decoding, playback, byte ranges, and MediaSource loading through the proxy.

Generate it with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=12 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 4 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -b:v 50k -c:a aac -b:a 32k -movflags frag_keyframe+empty_moov+default_base_moof -g 12 video.mp4
```

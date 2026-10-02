# Sound recordings (optional)

Every sound is synthesised. To replace one with a recording you have the rights to, put the file in this folder
and list it in `manifest.json`:

```json
{
  "engine_onboard":  [{ "rpm": 6000, "file": "onboard_6k.ogg" }, { "rpm": 12000, "file": "onboard_12k.ogg" }, { "rpm": 18000, "file": "onboard_18k.ogg" }],
  "engine_external": [{ "rpm": 9000, "file": "flyby_9k.ogg" }, { "rpm": 17000, "file": "flyby_17k.ogg" }],
  "beep": "light.ogg",
  "lights_out": "lights_out.ogg",
  "drs": "drs.ogg",
  "shift_up": "upshift.ogg"
}
```

- **Engine entries:** seamless loops recorded at a steady RPM. The game crossfades the two nearest loops and pitches them to the car's RPM.
- **One-shot entries:** play once.
- **Bad files:** a file that fails to load is skipped and the synth plays instead (warning in the console).

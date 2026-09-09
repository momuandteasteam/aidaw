# AIDAW

English | [日本語](README.md)

![System overview of AIDAW. A user gives instructions to an AI agent such as Codex, AIDAW carries out the music production work, and the resulting master audio, stems, MIDI, and project are returned to the user](docs/assets/aidaw-system-overview.png)

AIDAW is a **music production engine without an editing GUI, designed to be operated through conversations with AI agents such as Codex and Claude Code**.

Tell the agent what you want: “Make a song with this feel,” “Perform this score,” “Change only the bass,” or “Master this finished mix.” The agent operates AIDAW, while AIDAW keeps the production data and uses software instruments and effects to perform, mix, and export the music.

> **Development release 0.1.0:** Tested on Apple silicon macOS. Windows support is implemented, with testing on physical Windows hardware planned.

## Getting started

Give the following instruction to your vibe coding tool:

> Clone https://github.com/momuandteasteam/aidaw and set it up for this environment. Follow the instructions in the repository, and check which instruments and effects are available.

After setup, you can request music production work directly through the conversation.

```text
Create an EDM track about one minute long. Check the available instruments,
audition suitable candidates, and choose the best ones before producing it.
```

```text
Convert each part in this PDF score to MIDI and perform it with my installed instruments.
```

```text
Keep the drums in this song, rewrite only the bass part to make it heavier,
and update the mix.
```

```text
Analyze this WAV and master it with deeper low end and clearer vocals.
Listen to the exported result and revise it if necessary.
```

## What you can do

- **Create music through conversation:** Describe the genre, mood, duration, instrumentation, chord progression, or other musical goals. The AI agent builds the parts and arrangement, then AIDAW turns them into audio. You can listen and continue with requests such as “make the low end deeper” or “change the buildup.”
- **Turn sheet music into MIDI and audio:** Give a PDF or image to an AI agent that can read it. The agent transcribes the notes into separate MIDI parts in AIDAW and performs them with selected software instruments. You can later edit the notes, durations, velocities, and sounds.
- **Revise individual parts:** Drums, bass, piano, and other performances remain separate. AIDAW can regenerate the changed part and the required downstream mix stages while preserving the other performances.
- **Mix and master:** Control track levels, panning, inserts, sends to reverbs or delays, and master effects. You can also import a finished stereo mix, adjust its tone and loudness, and deliver it as WAV or MP3.
- **Use your installed plug-ins directly:** AIDAW supports VST3 on Windows, and VST3 plus Audio Units on macOS. You can name the instrument or effect you want, such as “use this synth for the bass” or “finish it with this EQ and limiter.”
- **Catalog and choose plug-ins:** Scan installed plug-ins to record available products, presets, exposed parameters, and compatibility results in a local database. AIDAW can search by musical style or instrumental role and suggest suitable instruments or effects from your collection using audition renders and previously recorded assessments.
- **Run the production environment as a server:** Install AIDAW, instruments, and effects on one machine, then request production work from another. Finished audio and project files can be retrieved remotely.

If you do not own any instruments or effects, you can begin with the included GM instrument, EQ, limiter, and reverb. When other instruments are available, the agent checks suitable candidates first. If a requested instrument cannot be loaded, AIDAW does not silently replace it with a different sound.

## How it works

1. **The user** describes the music or revision and provides audio or MIDI when needed.
2. **The AI agent** interprets the request and assembles the production operations through MCP or the API.
3. **AIDAW** manages the project, performance parts, instruments, mixer, and effects, then renders the audio offline.
4. **The user** listens to the exported result and gives further instructions, which are applied to the project.

Internally, AIDAW keeps MIDI and performances, track processing, level and panning, send effects, and mastering as separate stages. This allows a specific part or mix stage to be changed without rebuilding the entire song from the beginning.

Audio processing jobs run one at a time on the server and are queued when several requests arrive. Downloads of completed files are handled separately from audio processing.

## Deliverables

Work in progress and completed files are organized inside each project.

- Master WAV
- MP3 with optional metadata and artwork
- Premaster stereo mix
- Instrument performances and mix-ready stems
- Send effect returns such as reverb and delay
- Performance MIDI and notation MIDI
- Report containing the instruments, settings, and measurements used
- Portable project containing collected source material and committed audio

Stems and separate effect returns can be transferred to another DAW for further level and ambience adjustments. Plug-in binaries and licenses are not included in a portable project, but committed performance audio can be preserved.

## Current scope

AIDAW currently focuses on fixed-tempo, 48 kHz stereo offline production. Real-time recording and playback, tempo changes, sidechains, and arbitrary bus-to-bus routing are not yet supported. Audio Units are supported on macOS; VST3 is supported on macOS and Windows. Compatibility and authorization must be verified for each plug-in product in the environment where it is used.

## Documentation

- [Automated setup](docs/AUTO_SETUP.md)
- [Project, deliverable, and portability format](docs/IMPLEMENTATION_V2.md)
- [Mixer and part revisions](docs/MIXER_GRAPH.md)
- [Instrument and preset selection](docs/INSTRUMENT_SELECTION.md)
- [Remote server operation](docs/REMOTE_SERVER.md)
- [Architecture design](DESIGN.md)

Please report bugs and suggestions through [GitHub Issues](https://github.com/momuandteasteam/aidaw/issues). AIDAW is distributed under the [GNU Affero General Public License v3.0](LICENSE).

#pragma once
#include <atomic>
#include <mutex>

constexpr int previewQuantum = 64;

struct LiveSend { String busId; float gain = 1.0f; bool pre = false, enabled = true; };
struct LiveNote { juce::int64 start = 0, end = 0; int pitch = 60, channel = 1; juce::uint8 velocity = 100; };

static void panGain(juce::AudioBuffer<float>& audio, float gain, float pan, bool balance) {
    const float left = balance ? gain * std::min(1.0f, 1.0f - pan)
                               : gain * std::cos((pan + 1.0f) * juce::MathConstants<float>::pi / 4.0f);
    const float right = balance ? gain * std::min(1.0f, 1.0f + pan)
                                : gain * std::sin((pan + 1.0f) * juce::MathConstants<float>::pi / 4.0f);
    audio.applyGain(0, 0, audio.getNumSamples(), left);
    audio.applyGain(1, 0, audio.getNumSamples(), right);
}

class LiveGraph {
    struct Track {
        Builtin builtin; Chain chain; Automation automation; AlignmentDelay alignment;
        String id, sound; std::unique_ptr<juce::AudioFormatReader> source;
        juce::int64 sourceStart = 0, sourceEnd = 0, timeline = 0, fadeIn = 0, fadeOut = 0;
        std::vector<Event> events; std::vector<LiveNote> notes; std::vector<LiveSend> sends;
        size_t cursor = 0; bool pendingChase = false, mute = false, solo = false, toMaster = true, balance = false;
        float gain = 1.0f, pan = 0.0f;
    };
    struct Bus {
        String id; Chain chain; Automation automation; AlignmentDelay alignment;
        bool mute = false, solo = false; float gain = 1.0f, pan = 0.0f;
    };
    Playhead head; std::vector<std::unique_ptr<Track>> tracks; std::vector<std::unique_ptr<Bus>> buses;
    Chain master; Automation masterAutomation; AlignmentDelay mainAlignment;
    juce::AudioBuffer<float> raw {2, previewQuantum}, post {2, previewQuantum}, mix {2, previewQuantum};
    std::vector<juce::AudioBuffer<float>> busInputs;
    bool anyTrackSolo = false, anyBusSolo = false;
    float masterGain = 1.0f;
    int maxTrackLatency = 0, maxBusLatency = 0;

    void resetDelays() {
        for (auto& t : tracks) t->alignment.prepare(maxTrackLatency - t->chain.latency);
        for (auto& b : buses) b->alignment.prepare(maxBusLatency - b->chain.latency);
        mainAlignment.prepare(maxBusLatency);
    }
public:
    std::atomic<juce::int64> position {0};
    juce::int64 endFrame = 0, loopStart = 0, loopEnd = 0;
    bool loop = false;
    int processingLatency = 0;

    LiveGraph(juce::AudioPluginFormatManager& formats, const var& project, double tailSeconds, juce::int64 start, bool shouldLoop, juce::int64 requestedLoopStart, juce::int64 requestedLoopEnd) {
        check(static_cast<int>(project["ppq"]) == ppq && static_cast<int>(project["sample_rate"]) == 48000, "Expected PPQ 960 / 48kHz");
        const auto bpm = num(project["bpm"], 20, 300); const auto length = static_cast<int>(num(project["length_ticks"], 1, 10000000));
        const auto musicalFrames = project.hasProperty("duration_frames") ? project["duration_frames"].toString().getLargeIntValue()
            : static_cast<juce::int64>(std::llround(length * 60.0 * rate / (bpm * ppq)));
        endFrame = musicalFrames + static_cast<juce::int64>(std::llround(tailSeconds * rate));
        check(endFrame > 0 && endFrame <= static_cast<juce::int64>(1800 * rate), "Playback limit: 30 minutes");
        loop = shouldLoop; loopStart = requestedLoopStart; loopEnd = requestedLoopEnd > 0 ? requestedLoopEnd : musicalFrames;
        check(start >= 0 && start < endFrame, "Playback start is outside the project");
        check(!loop || (loopStart >= 0 && loopEnd > loopStart && loopEnd <= musicalFrames), "Invalid playback loop range");
        head.bpm = bpm; head.numerator = static_cast<int>(project["meter"][0]); head.denominator = static_cast<int>(project["meter"][1]);

        for (const auto& spec : arr(project["tracks"])) {
            auto t = std::make_unique<Track>(); t->id = spec["id"].toString(); t->events = schedule(spec, bpm, length);
            for (const auto& n : arr(spec["notes"])) {
                const auto toFrame = [bpm](double tick) { return static_cast<juce::int64>(std::llround(tick * 60.0 * rate / (bpm * ppq))); };
                const auto first = toFrame(num(n["tick"], 0, length)), last = toFrame(num(n["tick"], 0, length) + num(n["duration"], 1, length));
                t->notes.push_back({first, last, static_cast<int>(n["pitch"]), static_cast<int>(n["channel"]), static_cast<juce::uint8>(static_cast<int>(n["velocity"]))});
            }
            if (spec.hasProperty("audio_source_path")) {
                juce::AudioFormatManager audioFormats; audioFormats.registerBasicFormats();
                t->source.reset(audioFormats.createReaderFor(path(spec["audio_source_path"])));
                check(t->source && t->source->sampleRate == rate && t->source->numChannels <= 2, "Invalid source audio format");
                const auto clip = spec["audio_clip"];
                t->sourceStart = clip["start_frame"].toString().getLargeIntValue();
                t->sourceEnd = clip.hasProperty("end_frame") ? clip["end_frame"].toString().getLargeIntValue() : t->source->lengthInSamples;
                t->timeline = clip["timeline_frame"].toString().getLargeIntValue();
                t->fadeIn = clip["fade_in_frames"].toString().getLargeIntValue(); t->fadeOut = clip["fade_out_frames"].toString().getLargeIntValue();
            } else if (spec["instrument"]["kind"].toString() == "builtin") {
                t->sound = spec["instrument"]["sound"].toString();
            } else {
                t->chain.add(formats, spec["instrument"], head, true, true);
            }
            if (!t->source) { t->automation.prepare(spec["automation"], t->chain, bpm); t->automation.prepare(spec["instrument"]["automation"], t->chain, bpm); }
            for (const auto& fx : arr(spec["effects"])) { t->chain.add(formats, fx, head, false, true); t->automation.prepare(fx["automation"], t->chain, bpm, t->chain.plugins.size() - 1); }
            t->gain = static_cast<float>(juce::Decibels::decibelsToGain(num(spec["gain_db"], -96, 12))); t->pan = static_cast<float>(num(spec["pan"], -1, 1));
            t->mute = static_cast<bool>(spec["mute"]); t->solo = static_cast<bool>(spec["solo"]); t->toMaster = static_cast<bool>(spec["to_master"]); t->balance = spec["instrument"]["kind"].toString() == "audio";
            for (const auto& s : arr(spec["sends"])) t->sends.push_back({s["bus_id"].toString(), static_cast<float>(juce::Decibels::decibelsToGain(num(s["gain_db"], -96, 12))), s["position"].toString() == "pre_fader", static_cast<bool>(s["enabled"])});
            anyTrackSolo = anyTrackSolo || t->solo; maxTrackLatency = std::max(maxTrackLatency, t->chain.latency); tracks.push_back(std::move(t));
        }
        for (const auto& spec : arr(project["buses"])) {
            auto b = std::make_unique<Bus>(); b->id = spec["id"].toString(); b->mute = static_cast<bool>(spec["mute"]); b->solo = static_cast<bool>(spec["solo"]);
            b->gain = static_cast<float>(juce::Decibels::decibelsToGain(num(spec["gain_db"], -96, 12))); b->pan = static_cast<float>(num(spec["pan"], -1, 1));
            for (const auto& fx : arr(spec["effects"])) { b->chain.add(formats, fx, head, false, true); b->automation.prepare(fx["automation"], b->chain, bpm, b->chain.plugins.size() - 1); }
            anyBusSolo = anyBusSolo || b->solo; maxBusLatency = std::max(maxBusLatency, b->chain.latency); buses.push_back(std::move(b));
        }
        for (const auto& fx : arr(project["master_effects"])) { master.add(formats, fx, head, false, true); masterAutomation.prepare(fx["automation"], master, bpm, master.plugins.size() - 1); }
        if (project.hasProperty("master_gain_db")) masterGain = static_cast<float>(juce::Decibels::decibelsToGain(num(project["master_gain_db"], -96, 12)));
        processingLatency = maxTrackLatency + maxBusLatency + master.latency;
        check(processingLatency <= 480000, "Total playback latency exceeds 10 seconds");
        busInputs.resize(buses.size()); for (auto& b : busInputs) b.setSize(2, previewQuantum);
        resetDelays(); seek(start);
    }

    void seek(juce::int64 frame) {
        check(frame >= 0 && frame < endFrame, "Playback seek is outside the project"); position = frame; head.sample = frame;
        for (auto& t : tracks) {
            t->builtin.reset(); for (auto& p : t->chain.plugins) p->reset(); t->automation.reset(); t->automation.apply(frame);
            t->cursor = static_cast<size_t>(std::lower_bound(t->events.begin(), t->events.end(), frame, [](const Event& e, juce::int64 at) { return e.sample < at; }) - t->events.begin());
            t->pendingChase = std::any_of(t->notes.begin(), t->notes.end(), [frame](const LiveNote& n) { return n.start < frame && n.end > frame; });
        }
        for (auto& b : buses) { for (auto& p : b->chain.plugins) p->reset(); b->automation.reset(); b->automation.apply(frame); }
        for (auto& p : master.plugins) p->reset(); masterAutomation.reset(); masterAutomation.apply(frame); resetDelays();
    }

    void process(juce::AudioBuffer<float>& output) {
        auto at = position.load(); if (loop && at >= loopEnd) { seek(loopStart); at = position.load(); }
        if (at >= endFrame) { output.clear(); return; }
        head.sample = at; mix.clear(); for (auto& b : busInputs) b.clear();
        for (auto& t : tracks) {
            raw.clear(); juce::MidiBuffer midi;
            if (t->pendingChase) { for (const auto& n : t->notes) if (n.start < at && n.end > at) midi.addEvent(juce::MidiMessage::noteOn(n.channel, n.pitch, n.velocity), 0); t->pendingChase = false; }
            while (t->cursor < t->events.size() && t->events[t->cursor].sample < at + previewQuantum) { auto& event = t->events[t->cursor++]; if (event.sample >= at) midi.addEvent(event.message, static_cast<int>(event.sample - at)); }
            if (t->source) {
                const auto first = std::max(at, t->timeline), last = std::min(at + previewQuantum, t->timeline + t->sourceEnd - t->sourceStart);
                if (last > first) {
                    const auto offset = static_cast<int>(first - at), count = static_cast<int>(last - first);
                    check(t->source->read(&raw, offset, count, t->sourceStart + first - t->timeline, true, true), "Cannot read source clip during playback");
                    for (int i = offset; i < offset + count; ++i) { const auto pos = at + i - t->timeline, remaining = t->sourceEnd - t->sourceStart - 1 - pos; const double fade = std::min(t->fadeIn > 0 ? std::min(1.0, static_cast<double>(pos) / t->fadeIn) : 1.0, t->fadeOut > 0 ? std::min(1.0, static_cast<double>(remaining) / t->fadeOut) : 1.0); for (int c = 0; c < 2; ++c) raw.setSample(c, i, raw.getSample(c, i) * static_cast<float>(fade)); }
                }
                t->automation.apply(at); t->chain.process(raw, midi, true);
            } else { t->automation.apply(at); if (t->sound.isNotEmpty()) t->builtin.process(raw, midi, t->sound); t->chain.process(raw, midi, true); }
            t->alignment.process(raw); const bool audible = !t->mute && (!anyTrackSolo || t->solo); if (!audible) continue;
            post.makeCopyOf(raw, true); panGain(post, t->gain, t->pan, t->balance);
            if (t->toMaster && !anyBusSolo) { mix.addFrom(0, 0, post, 0, 0, previewQuantum); mix.addFrom(1, 0, post, 1, 0, previewQuantum); }
            for (const auto& send : t->sends) if (send.enabled) for (size_t i = 0; i < buses.size(); ++i) if (buses[i]->id == send.busId) { const auto& source = send.pre ? raw : post; busInputs[i].addFrom(0, 0, source, 0, 0, previewQuantum, send.gain); busInputs[i].addFrom(1, 0, source, 1, 0, previewQuantum, send.gain); }
        }
        mainAlignment.process(mix);
        for (size_t i = 0; i < buses.size(); ++i) {
            auto& b = buses[i]; juce::MidiBuffer noMidi; b->automation.apply(at); b->chain.process(busInputs[i], noMidi, true); b->alignment.process(busInputs[i]);
            if (!b->mute && (!anyBusSolo || b->solo)) { panGain(busInputs[i], b->gain, b->pan, true); mix.addFrom(0, 0, busInputs[i], 0, 0, previewQuantum); mix.addFrom(1, 0, busInputs[i], 1, 0, previewQuantum); }
        }
        juce::MidiBuffer noMidi; masterAutomation.apply(at); master.process(mix, noMidi, true); mix.applyGain(masterGain);
        const auto boundary = loop ? loopEnd : endFrame; const auto valid = static_cast<int>(std::clamp<juce::int64>(boundary - at, 0, previewQuantum));
        output.makeCopyOf(mix, true); if (valid < previewQuantum) output.clear(valid, previewQuantum - valid); position = at + valid;
    }
};

class DevicePlayer final : public juce::AudioIODeviceCallback {
    juce::AudioDeviceManager devices; LiveGraph graph; juce::AudioBuffer<float> quantum {2, previewQuantum};
    std::atomic<bool> paused {false}, finished {false}; std::atomic<juce::int64> requestedSeek {-1};
    mutable std::mutex errorMutex; String callbackError;
public:
    DevicePlayer(juce::AudioPluginFormatManager& formats, const var& request)
        : graph(formats, request["project"], num(request["tail_seconds"], 0, 30), request["start_frame"].toString().getLargeIntValue(), static_cast<bool>(request["loop"]), request["loop_start_frame"].toString().getLargeIntValue(), request["loop_end_frame"].toString().getLargeIntValue()) {
        const auto preferred = request["output_device"].toString();
        auto error = devices.initialise(0, 2, nullptr, true, preferred, nullptr); check(error.isEmpty(), "Cannot open output device: " + error);
        auto setup = devices.getAudioDeviceSetup(); setup.sampleRate = rate; setup.bufferSize = block;
        error = devices.setAudioDeviceSetup(setup, true); check(error.isEmpty(), "Cannot configure 48kHz output: " + error);
        auto* device = devices.getCurrentAudioDevice(); check(device != nullptr && device->getCurrentSampleRate() == rate, "A 48kHz output device is required");
        check(device->getCurrentBufferSizeSamples() % previewQuantum == 0, "Audio device buffer must be a multiple of 64 samples");
        devices.addAudioCallback(this);
    }
    ~DevicePlayer() override { devices.removeAudioCallback(this); devices.closeAudioDevice(); }
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* outputs, int outputChannels, int samples, const juce::AudioIODeviceCallbackContext&) override {
        for (int c = 0; c < outputChannels; ++c) if (outputs[c]) juce::FloatVectorOperations::clear(outputs[c], samples);
        if (paused || finished) return;
        try {
            const auto seek = requestedSeek.exchange(-1); if (seek >= 0) graph.seek(seek);
            for (int offset = 0; offset < samples; offset += previewQuantum) {
                graph.process(quantum); const auto count = std::min(previewQuantum, samples - offset);
                for (int c = 0; c < std::min(2, outputChannels); ++c) if (outputs[c]) juce::FloatVectorOperations::copy(outputs[c] + offset, quantum.getReadPointer(c), count);
                if (!graph.loop && graph.position >= graph.endFrame) { finished = true; break; }
            }
        } catch (const std::exception& e) { std::lock_guard lock(errorMutex); callbackError = e.what(); finished = true; }
    }
    void audioDeviceAboutToStart(juce::AudioIODevice*) override {}
    void audioDeviceStopped() override {}
    void pause(bool value) { paused = value; }
    void seek(juce::int64 frame) { check(frame >= 0 && frame < graph.endFrame, "Playback seek is outside the project"); requestedSeek = frame; finished = false; }
    bool isPaused() const { return paused; } bool isFinished() const { return finished; }
    String error() const { std::lock_guard lock(errorMutex); return callbackError; }
    var status(const String& state) const { auto* device = devices.getCurrentAudioDevice(); return obj({{"state", state}, {"position_frame", String(graph.position.load())}, {"position_seconds", graph.position.load() / rate}, {"duration_frames", String(graph.endFrame)}, {"duration_seconds", graph.endFrame / rate}, {"loop", graph.loop}, {"processing_latency_samples", graph.processingLatency}, {"output_device", device ? device->getName() : String()}, {"device_buffer_samples", device ? device->getCurrentBufferSizeSamples() : 0}, {"xruns", device ? device->getXRunCount() : -1}}); }
};

static void writePlayerStatus(const juce::File& path, const var& value) { check(path.replaceWithText(juce::JSON::toString(value)), "Cannot write playback status"); }

var playback(juce::AudioPluginFormatManager& formats, const var& request) {
    const auto statusPath = path(request["status_path"]), controlPath = path(request["control_path"]); DevicePlayer player(formats, request);
    int sequence = 0, statusCountdown = 0; String finalState = "completed";
    const auto status = [&](const String& state) { auto value = player.status(state); value.getDynamicObject()->setProperty("control_sequence", sequence); return value; };
    writePlayerStatus(statusPath, status("playing"));
    while (!player.isFinished()) {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(20);
        bool controlChanged = false;
        if (controlPath.existsAsFile()) {
            var control; if (juce::JSON::parse(controlPath.loadFileAsString(), control).wasOk()) {
                juce::Array<var> commands; if (control["commands"].isArray()) commands = *control["commands"].getArray(); else commands.add(control);
                for (const auto& command : commands) { const int next = static_cast<int>(command["sequence"]); if (next > sequence) {
                    sequence = next; controlChanged = true; const auto action = command["action"].toString();
                    if (action == "pause") player.pause(true); else if (action == "resume") player.pause(false);
                    else if (action == "seek") player.seek(command["frame"].toString().getLargeIntValue());
                    else if (action == "stop") { finalState = "stopped"; break; }
                }}
            }
        }
        if (controlChanged || ++statusCountdown >= 5) { writePlayerStatus(statusPath, status(player.isPaused() ? "paused" : "playing")); statusCountdown = 0; } if (finalState == "stopped") break;
    }
    const auto callbackError = player.error(); if (callbackError.isNotEmpty()) throw std::runtime_error(callbackError.toStdString());
    auto result = status(finalState); writePlayerStatus(statusPath, result); return result;
}

var playbackDevices() {
    juce::AudioDeviceManager manager; auto error = manager.initialise(0, 0, nullptr, true); check(error.isEmpty(), "Cannot inspect audio devices: " + error);
    juce::Array<var> types; String defaultOutput;
    for (auto* type : manager.getAvailableDeviceTypes()) { type->scanForDevices(); const auto names = type->getDeviceNames(false); juce::Array<var> outputs; for (const auto& name : names) if (name.isNotEmpty()) outputs.add(name); const auto index = type->getDefaultDeviceIndex(false); const auto selected = juce::isPositiveAndBelow(index, names.size()) ? names[index] : String(); if (defaultOutput.isEmpty() && selected.isNotEmpty()) defaultOutput = selected; types.add(obj({{"type", type->getTypeName()}, {"outputs", outputs}, {"default_output", selected}})); }
    return obj({{"device_types", types}, {"default_output", defaultOutput}, {"required_sample_rate", 48000}});
}

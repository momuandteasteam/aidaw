#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <vector>

namespace aidaw {
using juce::var;
using juce::String;
constexpr double rate = 48000;
constexpr int block = 512, ppq = 960;
var obj(std::initializer_list<std::pair<const char*, var>> fields) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : fields) o->setProperty(k, v);
    return var(o);
}
void check(bool ok, const String& message) { if (!ok) throw std::runtime_error(message.toStdString()); }
const juce::Array<var>& arr(const var& v) {
    check(v.isArray(), "Expected array"); return *v.getArray();
}
double num(const var& v, double lo, double hi) {
    check(v.isInt() || v.isInt64() || v.isDouble(), "Expected number");
    auto d = static_cast<double>(v); check(std::isfinite(d) && d >= lo && d <= hi, "Number out of range"); return d;
}
juce::File path(const var& v) {
    check(juce::File::isAbsolutePath(v.toString()), "Absolute path required"); return juce::File(v.toString());
}
juce::AudioPluginFormat* getFormat(juce::AudioPluginFormatManager& m, const String& name) {
    for (auto* f : m.getFormats()) if (f->getName() == name) return f;
    throw std::runtime_error("Unsupported format: " + name.toStdString());
}
var describe(const juce::PluginDescription& d) {
    return obj({{"plugin_id", d.pluginFormatName + ":" + d.manufacturerName + ":" + d.name + ":" + String::toHexString(d.uniqueId)},
        {"name", d.name}, {"vendor", d.manufacturerName}, {"version", d.version}, {"format", d.pluginFormatName},
        {"instrument", d.isInstrument}, {"inputs", d.numInputChannels}, {"outputs", d.numOutputChannels},
        {"description_xml", d.createXml()->toString()}, {"location", d.fileOrIdentifier}});
}
bool requiresIsolatedExit = false;
struct PluginDeleter {
    void operator()(juce::AudioPluginInstance* p) const { if (p) {
        // A flagged one-request worker leaves plugin teardown to immediate OS cleanup.
        // Do not call back into an NI module here: its background workers may already be racing exit.
        if (requiresIsolatedExit) return;
        delete p->getActiveEditor(); delete p;
    } }
};
using HostedPlugin = std::unique_ptr<juce::AudioPluginInstance, PluginDeleter>;
HostedPlugin load(juce::AudioPluginFormatManager& m, const var& s) {
    auto xml = juce::parseXML(s["description_xml"].toString()); juce::PluginDescription d;
    check(xml != nullptr && d.loadFromXml(*xml), "Invalid plugin description");
    // These exact NI versions can race their content/database workers during bundleExit.
    // Mark before module creation so even partial initialization uses one-request OS cleanup.
    const bool massiveXContent = d.name == "Massive X" && d.manufacturerName == "Native Instruments" && d.version == "1.7.1 (R0)";
    const bool kontaktContent = d.name == "Kontakt 8" && d.manufacturerName == "Native Instruments" && d.version == "8.13.0";
    if (massiveXContent || kontaktContent) requiresIsolatedExit = true;
    check(!getFormat(m, d.pluginFormatName)->requiresUnblockedMessageThreadDuringCreation(d), "AUv3 / asynchronous creation not supported");
    String error; HostedPlugin p(m.createPluginInstance(d, rate, block, error).release());
    check(p != nullptr, "Plugin load failed: " + error);
    // Some Native Instruments products schedule content initialization and state restoration on the message loop.
    const bool deferredContent = massiveXContent || kontaktContent;
    if (deferredContent) {
        auto* editor = p->createEditorAndMakeActive();
        check(editor != nullptr, "Native Instruments content initialization requires its hidden editor");
        editor->addToDesktop(0); // Attach the native view without displaying or operating it.
        juce::MessageManager::getInstance()->runDispatchLoopUntil(massiveXContent ? 6000 : 1000);
        p->setRateAndBufferSizeDetails(rate, block); p->prepareToPlay(rate, block);
    }
    if (s.hasProperty("state_base64")) {
        juce::MemoryBlock state; check(state.fromBase64Encoding(s["state_base64"].toString()), "Invalid state");
        p->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
        if (deferredContent) juce::MessageManager::getInstance()->runDispatchLoopUntil(massiveXContent ? 1500 : 8000);
    }
    if (s.hasProperty("program")) p->setCurrentProgram(static_cast<int>(num(s["program"], 0, std::max(0, p->getNumPrograms() - 1))));
    if (s.hasProperty("parameters")) for (const auto& change : arr(s["parameters"])) {
        bool found = false;
        for (auto* param : p->getParameters()) {
            auto* h = dynamic_cast<juce::HostedAudioProcessorParameter*>(param);
            if (h && h->getParameterID() == change["id"].toString()) {
                param->setValueNotifyingHost(static_cast<float>(num(change["value"], 0, 1))); found = true; break;
            }
        }
        check(found, "Unknown parameter ID: " + change["id"].toString());
    }
    // BBE Sonic Sweet 4.7.1 applies host control changes on its message loop.
    // Wait for those edits before preparing/rendering or serializing the state.
    if (d.manufacturerName == "BBE Sound" && d.name == "Sonic Maximizer" && d.version == "4.7.1") juce::MessageManager::getInstance()->runDispatchLoopUntil(250);
    return p;
}
}
#include "ModoBassPreset.h"
#include "KontaktPreset.h"
namespace aidaw {
var inspect(juce::AudioPluginFormatManager& m, const var& s) {
    auto p = load(m, s);
    // VST3 controller edits may be queued until processing. Flush before capturing state.
    if (p->getName() == "Massive X" || (s.hasProperty("parameters") && !arr(s["parameters"]).isEmpty())) {
        p->setNonRealtime(true); p->setRateAndBufferSizeDetails(rate, block); p->prepareToPlay(rate, block);
        const int channels = std::max({2, p->getTotalNumInputChannels(), p->getTotalNumOutputChannels()});
        check(channels <= 64, "Too many channels for parameter synchronization");
        juce::AudioBuffer<float> silence(channels, block); juce::MidiBuffer midi;
        for (int i = 0; i < 8; ++i) { silence.clear(); midi.clear(); p->processBlock(silence, midi); }
        p->releaseResources();
    }
    juce::Array<var> params, programs;
    for (auto* a : p->getParameters()) {
        auto* h = dynamic_cast<juce::HostedAudioProcessorParameter*>(a);
        juce::Array<var> choices; const auto steps = a->getNumSteps();
        if (steps > 1 && steps <= 256) for (int i = 0; i < steps; ++i) {
            const float value = static_cast<float>(i) / (steps - 1);
            choices.add(obj({{"value", value}, {"display", a->getText(value, 256)}}));
        }
        params.add(obj({{"id", h ? h->getParameterID() : String()}, {"name", a->getName(256)},
            {"unit", a->getLabel()}, {"value", a->getValue()}, {"display", a->getCurrentValueAsText()}, {"automatable", a->isAutomatable()}, {"steps", steps}, {"choices", choices}}));
    }
    for (int i = 0; i < std::min(1024, p->getNumPrograms()); ++i) programs.add(obj({{"index", i}, {"name", p->getProgramName(i)}}));
    juce::Array<var> buses;
    for(bool input:{true,false})for(int i=0;i<p->getBusCount(input);++i){auto* bus=p->getBus(input,i);buses.add(obj({{"direction",input?"input":"output"},{"index",i},{"name",bus->getName()},{"channels",bus->getNumberOfChannels()},{"enabled",bus->isEnabled()}}));}
    juce::MemoryBlock state; p->getStateInformation(state);
    return obj({{"buses",buses},{"program_count",p->getNumPrograms()},{"latency_stage","load_or_parameter_sync; render preparation may change it"},{"parameters", params}, {"programs", programs}, {"state_base64", state.toBase64Encoding()},
        {"latency_samples", p->getLatencySamples()}, {"tail_seconds", p->getTailLengthSeconds()}});
}
class Playhead final : public juce::AudioPlayHead {
public:
    juce::Optional<PositionInfo> getPosition() const override {
        PositionInfo p; p.setTimeInSamples(sample); p.setTimeInSeconds(static_cast<double>(sample) / rate);
        p.setBpm(bpm); p.setPpqPosition(static_cast<double>(sample) / rate * bpm / 60);
        p.setTimeSignature(TimeSignature{numerator, denominator}); p.setIsPlaying(true); return p;
    }
    juce::int64 sample = 0; double bpm = 120; int numerator = 4, denominator = 4;
};
struct Event { juce::int64 sample; juce::MidiMessage message; };
std::vector<Event> schedule(const var& track, double bpm, int length) {
    std::vector<Event> events;
    for (const auto& n : arr(track["notes"])) {
        auto start = num(n["tick"], 0, length - 1), duration = num(n["duration"], 1, length);
        check(start + duration <= length, "Note exceeds project end");
        auto key = static_cast<int>(num(n["pitch"], 0, 127)), ch = static_cast<int>(num(n["channel"], 1, 16));
        auto vel = static_cast<juce::uint8>(num(n["velocity"], 1, 127));
        auto sample = [bpm](double t) { return static_cast<juce::int64>(std::llround(t * 60 * rate / (bpm * ppq))); };
        events.push_back({sample(start), juce::MidiMessage::noteOn(ch, key, vel)});
        events.push_back({sample(start + duration), juce::MidiMessage::noteOff(ch, key)});
    }
    std::stable_sort(events.begin(), events.end(), [](const Event& a, const Event& b) {
        return a.sample == b.sample ? a.message.isNoteOff() && !b.message.isNoteOff() : a.sample < b.sample;
    });
    return events;
}
class Builtin {
    struct Voice { int note, channel; double phase, velocity, age, release; };
    std::vector<Voice> voices; uint32_t seed = 1;
public:
    void process(juce::AudioBuffer<float>& b, const juce::MidiBuffer& midi, const String& sound) {
        auto it = midi.begin(); b.clear();
        for (int i = 0; i < b.getNumSamples(); ++i) {
            while (it != midi.end() && (*it).samplePosition <= i) {
                auto m = (*it).getMessage();
                if (m.isNoteOn()) { check(voices.size() < 256, "Polyphony limit exceeded"); voices.push_back({m.getNoteNumber(), m.getChannel(), 0, m.getFloatVelocity(), 0, -1}); }
                if (m.isNoteOff()) for (auto& v : voices) if (v.note == m.getNoteNumber() && v.channel == m.getChannel() && v.release < 0) v.release = 0;
                ++it;
            }
            double value = 0;
            for (auto& v : voices) {
                double wave = std::sin(v.phase), env = v.release < 0 ? 1 : std::exp(-v.release * 45);
                if (sound == "keys") { wave += 0.25 * std::sin(2 * v.phase) * std::exp(-v.age * 3); env *= std::exp(-v.age * 1.8); }
                else if (sound == "bass") wave += 0.2 * std::sin(2 * v.phase);
                else if (sound == "drums") {
                    seed = seed * 1664525u + 1013904223u; auto noise = static_cast<double>(seed) / 2147483648.0 - 1;
                    wave = v.note <= 36 ? std::sin(juce::MathConstants<double>::twoPi * (48 * v.age + 2 * (1 - std::exp(-v.age * 35)))) * std::exp(-v.age * 13)
                        : noise * std::exp(-v.age * (v.note >= 42 ? 70 : 22));
                }
                value += wave * env * std::min(1.0, v.age * 500) * v.velocity * 0.12;
                v.phase = std::fmod(v.phase + juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz(v.note) / rate, juce::MathConstants<double>::twoPi);
                v.age += 1 / rate; if (v.release >= 0) v.release += 1 / rate;
            }
            std::erase_if(voices, [](const Voice& v) { return v.release > 0.3; });
            for (int c = 0; c < 2; ++c) b.setSample(c, i, static_cast<float>(value));
        }
    }
};
struct Chain {
    std::vector<HostedPlugin> plugins;
    std::vector<int> latencies;
    std::vector<int> messageLoopMs;
    int latency = 0;
    juce::int64 minimumProcessFrames = 0;
    juce::AudioBuffer<float> scratch {2, block};
    ~Chain() {
        // Exact NI builds marked for isolated exit have crashed inside releaseResources/module teardown.
        // Their one-request worker is terminated immediately after its durable JSON response.
        if (!requiresIsolatedExit) for (auto& p : plugins) p->releaseResources();
    }
    void add(juce::AudioPluginFormatManager& m, const var& s, Playhead& head, bool instrument) {
        auto p = load(m, s); p->disableNonMainBuses(); auto layout = p->getBusesLayout();
        if (!layout.outputBuses.isEmpty()) layout.outputBuses.getReference(0) = juce::AudioChannelSet::stereo();
        if (!layout.inputBuses.isEmpty()) layout.inputBuses.getReference(0) = instrument ? juce::AudioChannelSet::disabled() : juce::AudioChannelSet::stereo();
        check(p->setBusesLayout(layout), "Required stereo layout not supported");
        check(p->getChannelCountOfBus(false, 0) == 2 && p->getTotalNumInputChannels() <= 2 && p->getTotalNumOutputChannels() <= 64, "Stereo main output required; extra inputs are not supported");
        p->setNonRealtime(true); p->setPlayHead(&head); p->setRateAndBufferSizeDetails(rate, block); p->prepareToPlay(rate, block);
        // MODO BASS 2 initializes its physical model after prepareToPlay.
        // Prime with silence before musical time starts so the first note is retained.
        if (instrument && p->getPluginDescription().name == "MODO BASS 2"
            && p->getPluginDescription().version == "2.0.5") {
            juce::AudioBuffer<float> prime(std::max(2, p->getTotalNumOutputChannels()), block);
            for (int i = 0; i < 128; ++i) {
                prime.clear(); juce::MidiBuffer noEvents;
                p->processBlock(prime, noEvents);
                juce::MessageManager::getInstance()->runDispatchLoopUntil(1);
            }
        }
        if (p->getPluginDescription().name == "Massive X" && p->getPluginDescription().manufacturerName == "Native Instruments" && p->getPluginDescription().version == "1.7.1 (R0)") juce::MessageManager::getInstance()->runDispatchLoopUntil(500);
        const auto samples = p->getLatencySamples();
        check(samples >= 0 && samples <= 480000 && latency + samples <= 480000, "Plugin chain latency exceeds 10 seconds");
        latencies.push_back(samples); latency += samples;
        const auto d = p->getPluginDescription();
        const bool kontakt = d.name == "Kontakt 8" && d.manufacturerName == "Native Instruments" && d.version == "8.13.0";
        messageLoopMs.push_back(kontakt ? 2 : 0);
        if (kontakt) minimumProcessFrames = std::max<juce::int64>(minimumProcessFrames, static_cast<juce::int64>(4 * rate));
        plugins.push_back(std::move(p));
    }
    void process(juce::AudioBuffer<float>& b, juce::MidiBuffer& midi) {
        for (size_t index = 0; index < plugins.size(); ++index) {
            auto& p = plugins[index];
            check(p->getLatencySamples() == latencies[index], "Plugin latency changed during rendering; restart the render after settings stabilize");
            // Some AUs retain auxiliary outputs even after disableNonMainBuses().
            // Supply every declared channel, then route only the primary stereo bus.
            scratch.setSize(std::max(2, p->getTotalNumOutputChannels()), b.getNumSamples(), false, false, true);
            scratch.clear();
            for (int c = 0; c < 2; ++c) scratch.copyFrom(c, 0, b, c, 0, b.getNumSamples());
            p->processBlock(scratch, midi);
            if (messageLoopMs[index] > 0) juce::MessageManager::getInstance()->runDispatchLoopUntil(messageLoopMs[index]);
            check(p->getLatencySamples() == latencies[index], "Plugin latency changed during rendering; restart the render after settings stabilize");
            for (int c = 0; c < 2; ++c) b.copyFrom(c, 0, scratch, c, 0, b.getNumSamples());
        }
    }
};
// Instrument automation evaluated during audio processing, at most 64 samples apart.
struct Automation {
    struct Point { double sample, value; };
    struct Lane { juce::AudioProcessorParameter* parameter; std::vector<Point> points; size_t cursor = 0; bool linear; };
    std::vector<Lane> lanes;
    int updates = 0;
    void prepare(const var& spec, Chain& chain, double bpm, size_t index=0) {
        if (!spec.isArray()) return;
        for (const auto& a : arr(spec)) {
            check(index<chain.plugins.size(), "Automation requires a plugin");
            juce::AudioProcessorParameter* target = nullptr;
            for (auto* p : chain.plugins[index]->getParameters()) {
                auto* h = dynamic_cast<juce::HostedAudioProcessorParameter*>(p);
                if (h && h->getParameterID() == a["parameter_id"].toString()) target = p;
            }
            check(target && target->isAutomatable(), "Unknown or non-automatable instrument parameter: " + a["parameter_id"].toString());
            Lane lane { target, {}, 0, a["interpolation"].toString() == "linear" };
            for (const auto& point : arr(a["points"])) {
                Point p { (point.hasProperty("frame") ? static_cast<double>(point["frame"].toString().getLargeIntValue()) : num(point["tick"], 0, 10000000) * 60 * rate / (bpm * ppq)), num(point["value"], 0, 1) };
                check(lane.points.empty() || p.sample > lane.points.back().sample, "Automation points out of order"); lane.points.push_back(p);
            }
            check(!lane.points.empty(), "Empty automation lane"); lanes.push_back(std::move(lane));
        }
    }
    void apply(juce::int64 at) {
        for (auto& l : lanes) {
            if (at < l.points.front().sample) continue;
            while (l.cursor + 1 < l.points.size() && at >= l.points[l.cursor+1].sample) ++l.cursor;
            auto value = l.points[l.cursor].value;
            if (l.linear && l.cursor+1 < l.points.size()) {
                auto a = l.points[l.cursor], b = l.points[l.cursor+1];
                value += (b.value-a.value) * (at-a.sample) / (b.sample-a.sample);
            }
            l.parameter->setValueNotifyingHost(static_cast<float>(value)); ++updates;
        }
    }
};
// Delay faster parallel paths before summing; the final writer removes the common latency.
// This is independent of AU/VST3 and runs identically on macOS and Windows.
struct AlignmentDelay {
    juce::AudioBuffer<float> ring;
    int position = 0, delay = 0;
    void prepare(int samples) { delay = samples; position = 0; ring.setSize(2, std::max(1, samples)); ring.clear(); }
    void process(juce::AudioBuffer<float>& audio) {
        if (delay == 0) return;
        for (int i = 0; i < audio.getNumSamples(); ++i) {
            for (int c = 0; c < 2; ++c) {
                auto v = ring.getSample(c, position);
                ring.setSample(c, position, audio.getSample(c, i)); audio.setSample(c, i, v);
            }
            if (++position == delay) position = 0;
        }
    }
};
var analyze(const juce::File& source) {
    juce::AudioFormatManager formats; formats.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(source)); check(reader != nullptr, "Cannot read audio");
    check(reader->numChannels <= 2, "Mono/stereo analysis only");
    juce::AudioBuffer<float> b(static_cast<int>(reader->numChannels), 4096);
    double peak = 0, squares = 0; juce::int64 clipped = 0;
    for (juce::int64 at = 0; at < reader->lengthInSamples; at += 4096) {
        auto count = static_cast<int>(std::min<juce::int64>(4096, reader->lengthInSamples - at));
        check(reader->read(&b, 0, count, at, true, true), "Audio read failed");
        for (int c = 0; c < b.getNumChannels(); ++c) for (int i = 0; i < count; ++i) {
            auto v = static_cast<double>(b.getSample(c, i)); check(std::isfinite(v), "Non-finite audio");
            peak = std::max(peak, std::abs(v)); squares += v * v; if (std::abs(v) >= 0.999999) ++clipped;
        }
    }
    auto samples = reader->lengthInSamples * reader->numChannels;
    return obj({{"frames", reader->lengthInSamples}, {"sample_rate", reader->sampleRate}, {"channels", static_cast<int>(reader->numChannels)},
        {"duration_seconds", reader->lengthInSamples / reader->sampleRate}, {"sample_peak", peak},
        {"rms", samples > 0 ? std::sqrt(squares / static_cast<double>(samples)) : 0}, {"clipped_samples", clipped},
        {"silent", peak < 1.0e-5}, {"measurement", "sample-peak/rms; not LUFS or true-peak"}});
}
var compareAudio(const var& request) {
    juce::AudioFormatManager formats; formats.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reference(formats.createReaderFor(path(request["reference"])));
    check(reference && reference->numChannels <= 2, "Invalid comparison reference");
    std::vector<std::unique_ptr<juce::AudioFormatReader>> inputs;
    for(const auto& item:arr(request["paths"])) {
        auto reader=std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(path(item)));
        check(reader && reader->sampleRate==reference->sampleRate && reader->numChannels==reference->numChannels && reader->lengthInSamples==reference->lengthInSamples,"Comparison format/length mismatch");inputs.push_back(std::move(reader));
    }
    check(!inputs.empty() && inputs.size()<=128,"Comparison requires 1-128 inputs");
    juce::AudioBuffer<float> expected(2,4096),sum(2,4096),part(2,4096);double peak=0,squares=0;
    for(juce::int64 at=0;at<reference->lengthInSamples;at+=4096){
        auto n=static_cast<int>(std::min<juce::int64>(4096,reference->lengthInSamples-at));sum.clear();
        check(reference->read(&expected,0,n,at,true,true),"Comparison read failed");
        for(auto& input:inputs){check(input->read(&part,0,n,at,true,true),"Comparison read failed");for(int c=0;c<static_cast<int>(reference->numChannels);++c)sum.addFrom(c,0,part,c,0,n);}
        for(int c=0;c<static_cast<int>(reference->numChannels);++c)for(int i=0;i<n;++i){auto difference=static_cast<double>(sum.getSample(c,i))-expected.getSample(c,i);check(std::isfinite(difference),"Non-finite comparison audio");peak=std::max(peak,std::abs(difference));squares+=difference*difference;}
    }
    return obj({{"max_absolute_difference",peak},{"rms_difference",std::sqrt(squares/std::max<juce::int64>(1,reference->lengthInSamples*reference->numChannels))},{"frames",reference->lengthInSamples},{"exact_samples",peak==0}});
}
var render(juce::AudioPluginFormatManager& m, const var& request) {
    auto project = request["project"]; check(static_cast<int>(project["ppq"]) == ppq && static_cast<int>(project["sample_rate"]) == 48000, "Expected PPQ 960 / 48kHz");
    auto bpm = num(project["bpm"], 20, 300); auto length = static_cast<int>(num(project["length_ticks"], 1, 10000000));
    auto duration = (project.hasProperty("duration_frames") ? project["duration_frames"].toString().getLargeIntValue() / rate : length * 60.0 / (bpm * ppq)) + num(request["tail_seconds"], 0, 30); check(duration <= 1800, "Render limit: 30 minutes");
    auto frames = static_cast<juce::int64>(std::llround(duration * rate)); auto output = path(request["output"]);
    check(!output.exists(), "Output already exists"); check(output.getParentDirectory().createDirectory().wasOk(), "Cannot create output directory");
    Playhead head; head.bpm = bpm; head.numerator = static_cast<int>(project["meter"][0]); head.denominator = static_cast<int>(project["meter"][1]);
    struct Track { Builtin builtin; Chain chain; Automation automation; AlignmentDelay alignment; String id, sound; std::unique_ptr<juce::AudioFormatReader> source; bool cached = false; juce::int64 start = 0, end = 0, timeline = 0, fadeIn = 0, fadeOut = 0; std::vector<Event> events; size_t cursor = 0; float left = 1, right = 1; };
    std::vector<std::unique_ptr<Track>> tracks;
    for (const auto& s : arr(project["tracks"])) {
        auto t = std::make_unique<Track>(); t->id = s["id"].toString(); t->events = schedule(s, bpm, length);
        if (s.hasProperty("rendered_audio_path")) {
            t->cached = true;
            juce::AudioFormatManager formats; formats.registerBasicFormats();
            t->source.reset(formats.createReaderFor(path(s["rendered_audio_path"])));
            check(t->source && t->source->sampleRate == rate && t->source->numChannels == 2 && t->source->lengthInSamples == frames, "Invalid isolated stem format or length");
        } else if (s.hasProperty("audio_source_path")) {
            juce::AudioFormatManager formats; formats.registerBasicFormats();
            t->source.reset(formats.createReaderFor(path(s["audio_source_path"])));
            check(t->source && t->source->sampleRate == rate && t->source->numChannels <= 2, "Invalid source audio format");
            auto clip = s["audio_clip"];
            t->start = clip["start_frame"].toString().getLargeIntValue();
            t->end = clip.hasProperty("end_frame") ? clip["end_frame"].toString().getLargeIntValue() : t->source->lengthInSamples;
            t->timeline = clip["timeline_frame"].toString().getLargeIntValue();
            t->fadeIn = clip["fade_in_frames"].toString().getLargeIntValue(); t->fadeOut = clip["fade_out_frames"].toString().getLargeIntValue();
            check(t->start >= 0 && t->end > t->start && t->end <= t->source->lengthInSamples && t->timeline >= 0 && t->fadeIn >= 0 && t->fadeOut >= 0 && t->fadeIn+t->fadeOut <= t->end-t->start, "Invalid source clip");
        } else if (s["instrument"]["kind"].toString() == "builtin") {
            t->sound = s["instrument"]["sound"].toString(); check(t->sound == "sine" || t->sound == "keys" || t->sound == "bass" || t->sound == "drums", "Unknown sound");
        } else t->chain.add(m, s["instrument"], head, true);
        if (!t->cached) for (const auto& fx : arr(s["effects"])) {t->chain.add(m, fx, head, false);t->automation.prepare(fx["automation"],t->chain,bpm,t->chain.plugins.size()-1);}
        if (!t->source) {t->automation.prepare(s["automation"], t->chain, bpm);t->automation.prepare(s["instrument"]["automation"], t->chain,bpm);}
        auto gain = juce::Decibels::decibelsToGain(num(s["gain_db"], -96, 12)); auto pan = num(s["pan"], -1, 1);
        t->left = static_cast<float>(gain * std::cos((pan + 1) * juce::MathConstants<double>::pi / 4));
        t->right = static_cast<float>(gain * std::sin((pan + 1) * juce::MathConstants<double>::pi / 4)); if (t->cached || static_cast<bool>(s["unity_gain"])) t->left = t->right = 1.0f; // Stem already contains its track gain and pan.
        if(t->cached && s.hasProperty("cached_gain_db"))t->left=t->right=static_cast<float>(juce::Decibels::decibelsToGain(num(s["cached_gain_db"],-96,12)));
        if(!t->cached && s["instrument"]["kind"].toString()=="audio" && !static_cast<bool>(s["unity_gain"])) {t->left=static_cast<float>(gain*std::min(1.0,1-pan));t->right=static_cast<float>(gain*std::min(1.0,1+pan));}
        tracks.push_back(std::move(t));
    }
    Chain master; Automation masterAutomation; for (const auto& fx : arr(project["master_effects"])) {master.add(m, fx, head, false);masterAutomation.prepare(fx["automation"],master,bpm,master.plugins.size()-1);}
    int maximumTrackLatency = 0;
    for (const auto& t : tracks) maximumTrackLatency = std::max(maximumTrackLatency, t->chain.latency);
    const auto totalLatency = maximumTrackLatency + master.latency;
    check(totalLatency <= 480000, "Total compensated latency exceeds 10 seconds");
    juce::Array<var> latencyReport;
    for (auto& t : tracks) {
        t->alignment.prepare(maximumTrackLatency - t->chain.latency);
        latencyReport.add(obj({{"track_id", t->id}, {"plugin_samples", t->chain.latency}, {"alignment_samples", maximumTrackLatency - t->chain.latency}}));
    }
    const auto outputProcessFrames = frames + totalLatency;
    const auto processFrames = std::max(outputProcessFrames, std::max(master.minimumProcessFrames,
        std::accumulate(tracks.begin(), tracks.end(), static_cast<juce::int64>(0), [](auto maximum, const auto& t) { return std::max(maximum, t->chain.minimumProcessFrames); })));
    std::unique_ptr<juce::OutputStream> stream = output.createOutputStream(); check(stream != nullptr, "Cannot open output"); juce::WavAudioFormat wav;
    const bool floating = request["sample_format"].toString() == "float32";
    auto writer = wav.createWriterFor(stream, juce::AudioFormatWriterOptions{}.withSampleRate(rate).withNumChannels(2).withBitsPerSample(floating ? 32 : 24).withSampleFormat(floating ? juce::AudioFormatWriterOptions::SampleFormat::floatingPoint : juce::AudioFormatWriterOptions::SampleFormat::integral));
    check(writer != nullptr, "Cannot create WAV writer");
    juce::AudioBuffer<float> mix(2, block), audio(2, block); double peak = 0;
    const int quantum = !masterAutomation.lanes.empty() || std::any_of(tracks.begin(), tracks.end(), [](const auto& t) { return !t->automation.lanes.empty(); }) ? 64 : block;
    for (juce::int64 at = 0; at < processFrames; at += quantum) {
        auto count = static_cast<int>(std::min<juce::int64>(quantum, processFrames - at)); head.sample = at;
        mix.setSize(2, count, false, false, true); mix.clear();
        for (auto& t : tracks) {
            audio.setSize(2, count, false, false, true); audio.clear(); juce::MidiBuffer midi;
            while (t->cursor < t->events.size() && t->events[t->cursor].sample < at + count) {
                auto& event = t->events[t->cursor++]; midi.addEvent(event.message, static_cast<int>(event.sample - at));
            }
            if (t->cached && at < outputProcessFrames) {
                const auto readable = static_cast<int>(std::min<juce::int64>(count, outputProcessFrames - at));
                check(t->source->read(&audio, 0, readable, at, true, true), "Cannot read isolated stem");
            }
            else if (t->source) {
                const auto first = std::max(at, t->timeline), last = std::min(at + count, t->timeline + t->end - t->start);
                if (last > first) {
                    const auto offset = static_cast<int>(first-at), n = static_cast<int>(last-first);
                    check(t->source->read(&audio, offset, n, t->start+first-t->timeline, true, true), "Cannot read source clip");
                    for (int i=offset; i<offset+n; ++i) {
                        const auto pos=at+i-t->timeline, remaining=t->end-t->start-1-pos;
                        const double fade=std::min(t->fadeIn>0?std::min(1.0,static_cast<double>(pos)/t->fadeIn):1.0,t->fadeOut>0?std::min(1.0,static_cast<double>(remaining)/t->fadeOut):1.0);
                        for(int c=0;c<2;++c) audio.setSample(c,i,audio.getSample(c,i)*static_cast<float>(fade));
                    }
                }
                t->automation.apply(at);t->chain.process(audio,midi);
            }
            else { t->automation.apply(at); if (t->sound.isNotEmpty()) t->builtin.process(audio, midi, t->sound); t->chain.process(audio, midi); }
            t->alignment.process(audio);
            mix.addFrom(0, 0, audio, 0, 0, count, t->left); mix.addFrom(1, 0, audio, 1, 0, count, t->right);
        }
        juce::MidiBuffer noMidi; masterAutomation.apply(at);master.process(mix, noMidi);
        if(project.hasProperty("master_gain_db"))mix.applyGain(static_cast<float>(juce::Decibels::decibelsToGain(num(project["master_gain_db"],-96,12))));
        const auto writable = static_cast<int>(std::clamp<juce::int64>(outputProcessFrames - at, 0, count));
        const auto skip = static_cast<int>(std::clamp<juce::int64>(totalLatency - at, 0, writable));
        for (int c = 0; c < 2; ++c) for (int i = skip; i < writable; ++i) {
            auto v = mix.getSample(c, i); check(std::isfinite(v), "Non-finite plugin output"); peak = std::max(peak, static_cast<double>(std::abs(v)));
        }
        check(floating || peak <= 1, "Clipping detected: reduce track gain");
        if (writable > skip) check(writer->writeFromAudioSampleBuffer(mix, skip, writable - skip), "Audio write failed");
    }
    juce::Array<var> automationReport;
    for (const auto& t : tracks) if (!t->automation.lanes.empty()) automationReport.add(obj({{"track_id", t->id}, {"lanes", static_cast<int>(t->automation.lanes.size())}, {"parameter_updates", t->automation.updates}, {"control_interval_samples", quantum}}));
    if(!masterAutomation.lanes.empty())automationReport.add(obj({{"track_id","master"},{"lanes",static_cast<int>(masterAutomation.lanes.size())},{"parameter_updates",masterAutomation.updates},{"control_interval_samples",quantum}}));
    writer.reset(); return obj({{"automation", automationReport}, {"output", output.getFullPathName()}, {"analysis", analyze(output)}, {"revision", project["revision"]},
        {"latency_compensation", obj({{"tracks", latencyReport}, {"master_samples", master.latency}, {"trimmed_samples", totalLatency}})}});
}
var execute(const var& r) {
    juce::AudioPluginFormatManager m; juce::addDefaultFormatsToManager(m); auto command = r["command"].toString();
    if (command == "capabilities") {
        juce::Array<var> formats; for (auto* f : m.getFormats()) formats.add(f->getName());
        return obj({{"version", "0.1.0"}, {"formats", formats}, {"sample_rate", 48000}, {"platform", juce::SystemStats::getOperatingSystemName()}, {"offline", true}, {"latency_compensation", "static track and master chains"}});
    }
    if (command == "discover") {
        auto* f = getFormat(m, r["format"].toString()); auto paths = f->getDefaultLocationsToSearch();
        if (r.hasProperty("search_path")) paths = juce::FileSearchPath(r["search_path"].toString());
        juce::Array<var> results; for (const auto& p : f->searchPathsForPlugins(paths, true, false)) results.add(p);
        return obj({{"candidates", results}});
    }
    if (command == "scan") {
        juce::OwnedArray<juce::PluginDescription> types; getFormat(m, r["format"].toString())->findAllTypesForFile(types, r["location"].toString());
        juce::Array<var> results; for (auto* d : types) results.add(describe(*d)); check(!results.isEmpty(), "No plugin found"); return obj({{"plugins", results}});
    }
    if (command == "inspect") return inspect(m, r["plugin"]);
    if (command == "modo_bass_preset") return modoPreset(m, r);
    if (command == "kontakt_preset") return kontaktPreset(m, r);
    if (command == "render") return render(m, r);
    if (command == "compare_audio") return compareAudio(r);
    if (command == "analyze") return analyze(path(r["path"]));
    throw std::runtime_error("Unknown engine command");
}
int run(int argc, char** argv) {
    if (argc != 3) { std::cerr << "Usage: aidaw-engine request.json response.json\n"; return 2; }
    juce::ScopedJuceInitialiser_GUI runtime; juce::ScopedNoDenormals noDenormals; var response; int status = 0;
    try {
        var request; check(juce::JSON::parse(juce::File(String::fromUTF8(argv[1])).loadFileAsString(), request).wasOk(), "Invalid JSON");
        response = obj({{"ok", true}, {"result", execute(request)}});
    } catch (const std::exception& e) { response = obj({{"ok", false}, {"error", String(e.what())}}); status = 1; }
    if (!juce::File(String::fromUTF8(argv[2])).replaceWithText(juce::JSON::toString(response))) return 3;
    if (requiresIsolatedExit) {
#if JUCE_WINDOWS
        // Kontakt may keep a GUI/content thread inside DLL teardown even after the response is durable.
        // This executable is a one-request worker, so terminate without running third-party DLL detach code.
        TerminateProcess(GetCurrentProcess(), static_cast<UINT>(status));
#else
        std::_Exit(status);
#endif
    }
    return status;
}
}

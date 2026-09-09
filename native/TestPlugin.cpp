#include <juce_audio_utils/juce_audio_utils.h>
class TestInstrument final : public juce::AudioProcessor {
public:
    TestInstrument() : AudioProcessor(BusesProperties()
#if AIDAW_TEST_EFFECT
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
#endif
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
        addParameter(gain = new juce::AudioParameterFloat("gain", "Gain", 0.0f, 1.0f, 0.3f));
        addParameter(latency = new juce::AudioParameterInt("latency", "Latency", 0, 4096, 0));
    }
    const juce::String getName() const override { return JucePlugin_Name; }
    void prepareToPlay(double rate, int) override {
        sr = rate; phase = 0; active = false; cursor = 0;
        configuredLatency = latency->get(); setLatencySamples(configuredLatency);
        delay.setSize(2, std::max(1, configuredLatency)); delay.clear();
    }
    void releaseResources() override {}
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    bool hasEditor() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Sine"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock& block) override {
        juce::MemoryOutputStream out(block, false); out.writeFloat(gain->get()); out.writeInt(latency->get());
    }
    void setStateInformation(const void* data, int bytes) override {
        if (bytes >= 4) {
            juce::MemoryInputStream in(data, static_cast<size_t>(bytes), false); *gain = in.readFloat();
            if (bytes >= 8) *latency = in.readInt();
        }
    }
    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override {
#if AIDAW_TEST_EFFECT
        juce::ignoreUnused(midi); buffer.applyGain(gain->get());
#else
        buffer.clear();
        auto it = midi.begin();
        for (int i = 0; i < buffer.getNumSamples(); ++i) {
            while (it != midi.end() && (*it).samplePosition <= i) {
                const auto msg = (*it).getMessage();
                if (msg.isNoteOn()) { frequency = juce::MidiMessage::getMidiNoteInHertz(msg.getNoteNumber()); active = true; note = msg.getNoteNumber(); }
                if ((msg.isNoteOff() && msg.getNoteNumber() == note) || msg.isAllNotesOff()) active = false;
                ++it;
            }
            const auto v = active ? static_cast<float>(std::sin(phase) * gain->get()) : 0.0f;
            phase += juce::MathConstants<double>::twoPi * frequency / sr;
            if (phase > juce::MathConstants<double>::twoPi) phase -= juce::MathConstants<double>::twoPi;
            for (int c = 0; c < buffer.getNumChannels(); ++c) buffer.setSample(c, i, v);
        }
#endif
        if (configuredLatency > 0) for (int i = 0; i < buffer.getNumSamples(); ++i) {
            for (int c = 0; c < buffer.getNumChannels(); ++c) {
                const auto previous = delay.getSample(c, cursor);
                delay.setSample(c, cursor, buffer.getSample(c, i)); buffer.setSample(c, i, previous);
            }
            if (++cursor == configuredLatency) cursor = 0;
        }
    }
private:
    juce::AudioParameterFloat* gain{};
    juce::AudioParameterInt* latency{};
    juce::AudioBuffer<float> delay;
    int configuredLatency = 0, cursor = 0;
    double sr = 48000, phase = 0, frequency = 440;
    bool active = false;
    int note = 60;
};
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestInstrument(); }

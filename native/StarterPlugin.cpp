// SPDX-License-Identifier: AGPL-3.0-only
// Built-in distribution of normal VST3 processors; states contain no machine paths.
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_cryptography/juce_cryptography.h>
#include <deque>
#include <stdexcept>
#if AIDAW_STARTER_GM
#define TSF_IMPLEMENTATION
#include "tsf.h"
#endif
class Starter final : public juce::AudioProcessor {
    juce::AudioParameterFloat* control(const char* id, const char* name, float lo, float hi, float value) {
        auto* p = new juce::AudioParameterFloat(id, name, lo, hi, value); addParameter(p); return p;
    }
public:
    Starter() : AudioProcessor(BusesProperties()
#if !AIDAW_STARTER_GM
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
#endif
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
#if AIDAW_STARTER_GM
        addParameter(program = new juce::AudioParameterInt("program", "GM Program (0-127)", 0, 127, 0));
        addParameter(drums = new juce::AudioParameterBool("drums", "Drum Kit", false));
        gain = control("gain", "Output dB", -36, 6, -6);
        // Use the same resource layout on Windows and macOS. Optional override is
        // still hash checked; it cannot silently substitute a different bank.
        auto file = juce::File::getSpecialLocation(juce::File::currentExecutableFile)
            .getParentDirectory().getSiblingFile("starter-assets").getChildFile("FluidR3_GM.sf2");
        auto overridePath = juce::SystemStats::getEnvironmentVariable("AIDAW_SOUNDFONT", "");
        if (overridePath.isNotEmpty()) file = juce::File(overridePath);
        juce::MemoryBlock bytes;
        if (!file.loadFileAsData(bytes)) throw std::runtime_error("AIDAW GM bank missing. Run standard setup on the server.");
        if (juce::SHA256(bytes).toHexString() != "74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0")
            throw std::runtime_error("AIDAW GM bank checksum mismatch. Re-run setup; refusing substituted sound bank.");
        sf = tsf_load_memory(bytes.getData(), static_cast<int>(bytes.getSize()));
        if (!sf) throw std::runtime_error("Cannot load standard SoundFont");
        for (int n = 0; n < 128; ++n) if (tsf_get_presetindex(sf, 0, n) < 0) throw std::runtime_error("Incomplete GM bank");
        if (tsf_get_presetindex(sf, 128, 0) < 0) throw std::runtime_error("GM drum bank missing");
        tsf_set_max_voices(sf, 256);
#elif AIDAW_STARTER_EQ
        lowHz=control("low_hz","Low shelf Hz",30,300,80); lowDb=control("low_db","Low shelf dB",-18,18,0);
        midHz=control("mid_hz","Mid bell Hz",100,8000,300); midDb=control("mid_db","Mid bell dB",-18,18,0);
        midQ=control("mid_q","Mid Q",0.2f,8,0.7f);
        highHz=control("high_hz","High shelf Hz",1000,16000,6000); highDb=control("high_db","High shelf dB",-18,18,0);
#elif AIDAW_STARTER_Limiter
        gain=control("drive","Drive dB",0,24,0); ceiling=control("ceiling","Ceiling dBFS",-12,0,-1);
        release=control("release","Release ms",10,1000,100);
#else
        room=control("room","Room size",0,0.9f,0.5f); damping=control("damping","Damping",0,1,0.5f);
        width=control("width","Width",0,1,1); wet=control("wet","Wet",0,1,1);
        lowHz=control("low_cut","Reverb low cut Hz",20,1000,180);
#endif
    }
    ~Starter() override {
#if AIDAW_STARTER_GM
        if (sf) tsf_close(sf);
#endif
    }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return JucePlugin_IsSynth; }
    bool producesMidi() const override { return false; }
    bool isBusesLayoutSupported(const BusesLayout& l) const override {
        return l.getMainOutputChannelSet()==juce::AudioChannelSet::stereo()
#if !AIDAW_STARTER_GM
            && l.getMainInputChannelSet()==juce::AudioChannelSet::stereo()
#endif
        ;
    }
    bool hasEditor() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    double getTailLengthSeconds() const override {
#if AIDAW_STARTER_Reverb
        return 12;
#elif AIDAW_STARTER_GM
        return 5;
#else
        return 0;
#endif
    }
    int getNumPrograms() override {
#if AIDAW_STARTER_GM
        return 128;
#else
        return 1;
#endif
    }
    int getCurrentProgram() override {
#if AIDAW_STARTER_GM
        return program->get();
#else
        return 0;
#endif
    }
    void setCurrentProgram(int p) override {
#if AIDAW_STARTER_GM
        *program=juce::jlimit(0,127,p);
#else
        juce::ignoreUnused(p);
#endif
    }
    const juce::String getProgramName(int p) override {
#if AIDAW_STARTER_GM
        return juce::String(tsf_bank_get_presetname(sf,0,juce::jlimit(0,127,p)));
#else
        juce::ignoreUnused(p); return "Default";
#endif
    }
    void changeProgramName(int,const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock& b) override {
        juce::XmlElement xml("AIDAWStarter1"); xml.setAttribute("processor", getName());
        for (auto* p:getParameters()) if (auto* v=dynamic_cast<juce::AudioProcessorParameterWithID*>(p)) xml.setAttribute(v->paramID, double(p->getValue()));
        copyXmlToBinary(xml,b);
    }
    void setStateInformation(const void* data,int size) override {
        auto xml=getXmlFromBinary(data,size);
        if (!xml || !xml->hasTagName("AIDAWStarter1") || xml->getStringAttribute("processor")!=getName()) return;
        for (auto* p:getParameters()) if (auto* v=dynamic_cast<juce::AudioProcessorParameterWithID*>(p)) {
            auto value=xml->getDoubleAttribute(v->paramID,p->getValue());
            if (std::isfinite(value)) p->setValueNotifyingHost(float(juce::jlimit(0.0,1.0,value)));
        }
    }
    void prepareToPlay(double sampleRate,int maxBlock) override {
        sr=sampleRate; setLatencySamples(0);
        for(auto& channel:filters) for(auto& f:channel) f.reset();
#if AIDAW_STARTER_GM
        tsf_reset(sf); tsf_set_output(sf, TSF_STEREO_INTERLEAVED, int(sr), gain->get());
        audio.resize(size_t(std::max(maxBlock,512))*2); lastProgram=-1; lastDrums=-1;
        for(int ch=0;ch<16;++ch) { tsf_channel_set_presetnumber(sf,ch,0,ch==9); tsf_channel_midi_control(sf,ch,121,0); }
#elif AIDAW_STARTER_Limiter
        lookahead=std::max(1,int(std::round(sr*0.005))); setLatencySamples(lookahead);
        delay.setSize(2,lookahead+1); delay.clear(); index=0; envelope=1; peaks.clear();
#elif AIDAW_STARTER_Reverb
        juce::Reverb::Parameters initial;
        initial.roomSize=room->get(); initial.damping=damping->get(); initial.width=width->get(); initial.wetLevel=1; initial.dryLevel=0;
        // Set targets before resetting the smoothing ramps: otherwise Freeverb's
        // constructor dry gain leaks into the beginning of a wet-only send stem.
        reverb.setParameters(initial); reverb.setSampleRate(sr); reverb.reset(); scratch.setSize(2,std::max(maxBlock,512));
#endif
    }
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>& b,juce::MidiBuffer& midi) override {
        juce::ScopedNoDenormals noDenormals;
        const int n=b.getNumSamples(); if(b.getNumChannels()<2) return;
#if AIDAW_STARTER_GM
        b.clear(); tsf_set_volume(sf,juce::Decibels::decibelsToGain(gain->get()));
        if(lastProgram!=program->get() || lastDrums!=int(drums->get())) {
            lastProgram=program->get(); lastDrums=int(drums->get());
            for(int ch=0;ch<16;++ch) tsf_channel_set_presetnumber(sf,ch,(ch==9||lastDrums)?0:lastProgram,ch==9||lastDrums);
        }
        if(audio.size()<size_t(n)*2) audio.resize(size_t(n)*2);
        int offset=0;
        auto render=[&](int end){if(end>offset) {tsf_render_float(sf,audio.data()+offset*2,end-offset,0);offset=end;}};
        for(const auto entry:midi) {
            render(juce::jlimit(0,n,entry.samplePosition)); const auto msg=entry.getMessage(); const int ch=msg.getChannel()-1;
            if(ch<0||ch>15)continue;
            if(msg.isNoteOn())tsf_channel_note_on(sf,ch,msg.getNoteNumber(),msg.getFloatVelocity());
            else if(msg.isNoteOff())tsf_channel_note_off(sf,ch,msg.getNoteNumber());
            else if(msg.isProgramChange())tsf_channel_set_presetnumber(sf,ch,msg.getProgramChangeNumber(),ch==9||lastDrums);
            else if(msg.isPitchWheel())tsf_channel_set_pitchwheel(sf,ch,msg.getPitchWheelValue());
            else if(msg.isController())tsf_channel_midi_control(sf,ch,msg.getControllerNumber(),msg.getControllerValue());
        }
        render(n);for(int i=0;i<n;++i)for(int c=0;c<2;++c)b.setSample(c,i,audio[size_t(i)*2+c]);
#elif AIDAW_STARTER_EQ
        juce::ignoreUnused(midi);
        auto low=juce::IIRCoefficients::makeLowShelf(sr,std::min(double(lowHz->get()),sr*0.45),0.707,juce::Decibels::decibelsToGain(lowDb->get()));
        auto mid=juce::IIRCoefficients::makePeakFilter(sr,std::min(double(midHz->get()),sr*0.45),midQ->get(),juce::Decibels::decibelsToGain(midDb->get()));
        auto high=juce::IIRCoefficients::makeHighShelf(sr,std::min(double(highHz->get()),sr*0.45),0.707,juce::Decibels::decibelsToGain(highDb->get()));
        for(int c=0;c<2;++c){filters[c][0].setCoefficients(low);filters[c][1].setCoefficients(mid);filters[c][2].setCoefficients(high);for(auto& f:filters[c])f.processSamples(b.getWritePointer(c),n);}
#elif AIDAW_STARTER_Limiter
        juce::ignoreUnused(midi); const float drive=juce::Decibels::decibelsToGain(gain->get()), cap=juce::Decibels::decibelsToGain(ceiling->get());
        const float decay=float(std::exp(-1.0/(sr*release->get()*0.001)));
        for(int i=0;i<n;++i,++index) {
            const int write=int(index%(lookahead+1)); float peak=0;
            for(int c=0;c<2;++c){float x=b.getSample(c,i)*drive;delay.setSample(c,write,x);peak=std::max(peak,std::abs(x));}
            while(!peaks.empty()&&peaks.back().second<=peak)peaks.pop_back(); peaks.emplace_back(index,peak);
            while(!peaks.empty()&&peaks.front().first<index-lookahead)peaks.pop_front();
            const float desired=peaks.front().second>cap?cap/peaks.front().second:1;
            envelope=std::min(desired,1-(1-envelope)*decay);
            for(int c=0;c<2;++c){const float x=index>=lookahead?delay.getSample(c,int((index-lookahead)%(lookahead+1)))*envelope:0;b.setSample(c,i,juce::jlimit(-cap,cap,x));}
        }
#else
        juce::ignoreUnused(midi);
        scratch.setSize(2,n,false,false,true);for(int c=0;c<2;++c)scratch.copyFrom(c,0,b,c,0,n);
        auto lowCut=juce::IIRCoefficients::makeHighPass(sr,std::min(double(lowHz->get()),sr*0.45));
        for(int c=0;c<2;++c){filters[c][0].setCoefficients(lowCut);filters[c][0].processSamples(b.getWritePointer(c),n);}
        juce::Reverb::Parameters p; p.roomSize=room->get();p.damping=damping->get();p.width=width->get();p.wetLevel=1;p.dryLevel=0;p.freezeMode=0;
        reverb.setParameters(p);reverb.processStereo(b.getWritePointer(0),b.getWritePointer(1),n);
        b.applyGain(wet->get());for(int c=0;c<2;++c)b.addFrom(c,0,scratch,c,0,n,1-wet->get());
#endif
        midi.clear();
    }
private:
    double sr=48000;
    juce::AudioParameterFloat *gain{},*lowHz{},*lowDb{},*midHz{},*midDb{},*midQ{},*highHz{},*highDb{},*ceiling{},*release{},*room{},*damping{},*width{},*wet{};
    juce::AudioParameterInt* program{};juce::AudioParameterBool* drums{};
    juce::IIRFilter filters[2][3];juce::Reverb reverb;juce::AudioBuffer<float> scratch,delay;
    int lookahead=240;int64_t index=0;float envelope=1;std::deque<std::pair<int64_t,float>> peaks;
#if AIDAW_STARTER_GM
    tsf* sf{};std::vector<float> audio;int lastProgram=-1,lastDrums=-1;
#endif
};
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new Starter();}

#pragma once
// PCM is loaded on the control thread before opening the device. The callback only
// reads bounded buffers; no decoding, plugin work, allocation or file access.
class PreparedComparison {
    juce::AudioBuffer<float> audio[2];
    int current=0, destination=0, remaining=0;
public:
    static constexpr int fadeSamples=240;
    std::atomic<int> requested{0},applied{0};
    std::atomic<juce::int64> switchFrame{0};
    PreparedComparison(const var& spec){
        const auto& paths=arr(spec["paths"]);check(paths.size()==2,"Comparison needs two audio files");
        juce::AudioFormatManager formats;formats.registerBasicFormats();juce::int64 total=0;
        for(int i=0;i<2;++i){std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(path(paths[i])));
            check(reader&&reader->sampleRate==48000&&reader->numChannels==2,"Invalid prepared comparison audio");
            total+=reader->lengthInSamples*8;check(reader->lengthInSamples>0&&total<=256*1024*1024,"Comparison PCM exceeds 256 MiB");
            audio[i].setSize(2,static_cast<int>(reader->lengthInSamples));check(reader->read(&audio[i],0,audio[i].getNumSamples(),0,true,true),"Cannot read prepared comparison");}
        current=destination=static_cast<int>(num(spec["slot"],0,1));requested=current;applied=current;
    }
    void replaceInactive(int slot,const juce::File& file){
        check(slot>=0&&slot<2&&applied.load()==requested.load()&&slot!=applied.load(),"Comparison slot is still in use");
        juce::AudioFormatManager formats;formats.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
        check(reader&&reader->sampleRate==48000&&reader->numChannels==2,"Invalid replacement audio");
        check(reader->lengthInSamples>0&&(reader->lengthInSamples+audio[1-slot].getNumSamples())*8<=256*1024*1024,"Comparison PCM exceeds 256 MiB");
        juce::AudioBuffer<float> next(2,static_cast<int>(reader->lengthInSamples));
        check(reader->read(&next,0,next.getNumSamples(),0,true,true),"Cannot read replacement audio");
        audio[slot]=std::move(next); // Only inactive PCM; publication happens through requested.
    }
    bool transitioning()const noexcept{return applied.load()!=requested.load();}
    juce::int64 duration()const{return audio[applied.load()].getNumSamples();}
    bool transition(bool paused,juce::int64 frame){
        const auto next=requested.load(std::memory_order_acquire);
        if(next==destination)return false;
        destination=next;remaining=paused?0:fadeSamples;switchFrame=frame;
        if(paused){current=destination;applied.store(current,std::memory_order_release);}return true;
    }
    void process(juce::AudioBuffer<float>& output,juce::int64 frame)noexcept{
        for(int i=0;i<output.getNumSamples();++i){const float blend=remaining?float(fadeSamples-remaining+1)/fadeSamples:1.0f;
            for(int c=0;c<2;++c){const auto at=frame+i;const auto sample=[&](int slot){return at>=0&&at<audio[slot].getNumSamples()?audio[slot].getSample(c,static_cast<int>(at)):0.0f;};output.setSample(c,i,remaining?sample(current)*(1-blend)+sample(destination)*blend:sample(current));}
            if(remaining&&!--remaining){current=destination;applied.store(current,std::memory_order_release);}
        }
    }
};

// Exercises the exact callback crossfade without opening an output device.
var preparedComparisonProbe(const var& request){
    PreparedComparison pair(request["prepared_comparison"]);juce::AudioBuffer<float> buffer(2,64);juce::Array<var> results;juce::int64 frame=0;float previous=0;bool hasPrevious=false;
    for(const auto& segment:arr(request["segments"])){if(segment.hasProperty("path"))pair.replaceInactive(static_cast<int>(num(segment["slot"],0,1)),path(segment["path"]));pair.requested=static_cast<int>(num(segment["slot"],0,1));pair.transition(false,frame);double maxStep=0,first=0,last=0;
        const int blocks=static_cast<int>(num(segment["blocks"],1,1000));for(int b=0;b<blocks;++b){pair.process(buffer,frame);frame+=64;for(int i=0;i<64;++i){float value=buffer.getSample(0,i);if(b==0&&i==0)first=value;if(hasPrevious)maxStep=std::max(maxStep,double(std::abs(value-previous)));previous=value;hasPrevious=true;last=value;}}
        results.add(obj({{"first",first},{"last",last},{"max_step",maxStep},{"slot",pair.applied.load()}}));}
    return obj({{"segments",results}});
}

#pragma once
#include <atomic>
#include <algorithm>
#include <cmath>
// Fixed 400 ms stereo windows at the engine's 48 kHz rate. Pre-monitor signal.
class ComparisonMeter {
    double sum=0; float peak=0; int frames=0;
public:
    std::atomic<double> rms{0}; std::atomic<float> samplePeak{0}; std::atomic<bool> valid{false};
    void reset() noexcept {sum=0;peak=0;frames=0;valid.store(false,std::memory_order_release);}
    void process(const float* left,const float* right,int count) noexcept {
        for(int i=0;i<count;++i){
            const auto l=left[i],r=right[i];sum+=(double(l)*l+double(r)*r)*0.5;
            peak=std::max(peak,std::max(std::abs(l),std::abs(r)));
            if(++frames==19200){rms.store(std::sqrt(sum/frames),std::memory_order_relaxed);samplePeak.store(peak,std::memory_order_relaxed);valid.store(true,std::memory_order_release);sum=0;peak=0;frames=0;}
        }
    }
};

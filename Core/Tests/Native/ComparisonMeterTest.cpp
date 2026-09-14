#include "../../Source/Audio/ComparisonMeter.h"
#include <array>
#include <cassert>
#include <iostream>
int main(){
 ComparisonMeter meter;std::array<float,64> l{},r{};
 for(int block=0;block<300;++block){for(int i=0;i<64;++i){l[i]=r[i]=0.5f*std::sin(2*3.141592653589793*1000*(block*64+i)/48000);}meter.process(l.data(),r.data(),64);}
 assert(meter.valid);assert(std::abs(meter.rms-0.5/std::sqrt(2))<1e-6);assert(std::abs(meter.samplePeak-0.5)<1e-6);
 l.fill(0);r.fill(0);for(int i=0;i<300;++i)meter.process(l.data(),r.data(),64);assert(meter.rms==0&&meter.samplePeak==0);
 l.fill(1);for(int i=0;i<300;++i)meter.process(l.data(),r.data(),64);assert(std::abs(meter.rms-1/std::sqrt(2))<1e-6);assert(meter.samplePeak==1);
 std::cout<<"400ms stereo RMS, peak and silence verified\n";
}

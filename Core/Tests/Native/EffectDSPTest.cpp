// SPDX-License-Identifier: AGPL-3.0-only
#include "../../Source/StarterPlugins/EffectDSP.h"
#include <iostream>
#include <stdexcept>
using namespace aidawfx;
void require(bool v,const char* reason){if(!v)throw std::runtime_error(reason);}
constexpr double tau=juce::MathConstants<double>::twoPi;
using Signal=std::vector<std::array<float,2>>;
Signal tone(double sr,double hz,double amplitude=.2,int length=0){Signal s(size_t(length?length:int(sr)));for(size_t i=0;i<s.size();++i)s[i]={float(amplitude*std::sin(tau*hz*i/sr)),float(amplitude*.5*std::sin(tau*hz*i/sr))};return s;}
template<class F> Signal run(F& f,Signal s,int block){juce::AudioBuffer<float>b(2,block);for(size_t start=0;start<s.size();start+=size_t(block)){int n=int(std::min(size_t(block),s.size()-start));juce::AudioBuffer<float> view(b.getArrayOfWritePointers(),2,n);for(int i=0;i<n;++i)for(int c=0;c<2;++c)view.setSample(c,i,s[start+i][c]);f.process(view);for(int i=0;i<n;++i)for(int c=0;c<2;++c){float v=view.getSample(c,i);require(std::isfinite(v),"Nonfinite output");s[start+i][c]=v;}}return s;}
double rms(const Signal& s,int channel=0){double sum=0;for(size_t i=s.size()/2;i<s.size();++i)sum+=double(s[i][channel])*s[i][channel];return std::sqrt(sum/(s.size()-s.size()/2));}
double amplitude(const Signal& s,double sr,double hz){double re=0,im=0;for(size_t i=s.size()/2;i<s.size();++i){re+=s[i][0]*std::cos(tau*hz*i/sr);im+=s[i][0]*std::sin(tau*hz*i/sr);}return 2*std::hypot(re,im)/(s.size()-s.size()/2);}
std::array<double,22> eqDefault(){return {80,0,300,0,.7,6000,0,700,0,1,1500,0,1,3000,0,1,6000,0,1,10000,0,1};}
int main(){try{
 for(double sr:{44100.,48000.,96000.}){
  EQ eq;auto settings=eqDefault();eq.prepare(sr,settings);auto input=tone(sr,997),flat=run(eq,input,127);double error=0;for(size_t i=0;i<input.size();++i)error=std::max(error,std::abs(double(input[i][0]-flat[i][0])));require(error<1.e-6,"EQ unity error");
  for(int band=0;band<8;++band){settings=eqDefault();double hz;if(band==0){settings[1]=6;hz=10;}else if(band==7){settings[6]=6;hz=sr*.45;}else if(band==1){settings[3]=6;hz=settings[2];}else{settings[8+(band-2)*3]=6;hz=settings[7+(band-2)*3];}eq.prepare(sr,settings);auto dry=tone(sr,hz),wet=run(eq,dry,63);double gain=20*std::log10(rms(wet)/rms(dry));require(std::abs(gain-6)<.12,"EQ band gain response");}
  settings=eqDefault();settings[8]=18;settings[9]=12;eq.prepare(sr,eqDefault());eq.target(settings);run(eq,tone(sr,700),31);
  Imager im;im.prepare(sr,1,1,120);auto unity=run(im,input,73);for(size_t i=0;i<input.size();++i)require(std::abs(unity[i][0]-input[i][0])<1.e-7,"Imager unity");
  im.prepare(sr,2,0,400);auto wide=run(im,input,137);for(size_t i=0;i<input.size();++i)require(std::abs((wide[i][0]+wide[i][1])-(input[i][0]+input[i][1]))<2.e-7,"Imager mono sum changed");
  auto side=tone(sr,40);for(auto& x:side)x[1]=-x[0];im.prepare(sr,1,0,400);auto bass=run(im,side,47);require(rms(bass)/rms(side)<.02,"Imager low bass not suppressed");
  Gain trim;for(double db:{-60.,-12.,0.,6.}){trim.prepare(sr,db);auto gained=run(trim,input,63);const double ratio=rms(gained)/rms(input);require(std::abs(20*std::log10(ratio)-db)<.00001,"Gain inaccurate");for(auto sample:gained)require(std::abs(sample[1]-.5*sample[0])<1.e-7,"Gain stereo mismatch");}
  trim.prepare(sr,-60);require(rms(run(trim,Signal(8192,{0,0}),127))==0,"Gain adds noise");Gain ga,gb;ga.prepare(sr,0);gb.prepare(sr,0);ga.target(-12);gb.target(-12);auto constant=Signal(4096,{.5f,.25f}),ramp=run(ga,constant,31),rampB=run(gb,constant,512);require(ramp==rampB,"Gain ramp depends on blocks");for(size_t i=1;i<ramp.size();++i)require(ramp[i][0]<=ramp[i-1][0],"Gain ramp not monotonic");
  std::cout<<"Gain sr="<<sr<<" -60/-12/0/+6dB ratio, stereo, silence, ramp passed\n";
  BassMono bassMono;bassMono.prepare(sr,120,0);auto bassUnity=run(bassMono,input,63);for(size_t i=0;i<input.size();++i)for(int c=0;c<2;++c)require(std::abs(bassUnity[i][c]-input[i][c])<1.e-7,"BassMono amount zero is not unity");
  auto mono=input;for(auto& sample:mono)sample[1]=sample[0];bassMono.prepare(sr,500,1);auto monoOut=run(bassMono,mono,137);require(monoOut==mono,"BassMono modifies mono input");
  double ratios[3];int measureIndex=0;for(double frequency:{30.,120.,1200.}){auto source=tone(sr,frequency);for(auto& sample:source)sample[1]=-sample[0];bassMono.prepare(sr,120,1);auto result=run(bassMono,source,127);ratios[measureIndex++]=rms(result)/rms(source);}
  require(ratios[0]<.0041,"BassMono low side rejection <47dB");require(std::abs(ratios[1]-std::sqrt(.5))<.002,"BassMono cutoff response");require(std::abs(ratios[2]-1)<.001,"BassMono high-band width");
  bassMono.prepare(sr,120,1);auto bassOut=run(bassMono,input,511);for(size_t i=0;i<input.size();++i)require(std::abs((bassOut[i][0]+bassOut[i][1])-(input[i][0]+input[i][1]))<2.e-7,"BassMono mono sum changed");
  BassMono bmA,bmB;bmA.prepare(sr,20,0);bmB.prepare(sr,20,0);bmA.target(500,1);bmB.target(500,1);auto variedA=run(bmA,input,31),variedB=run(bmB,input,512);require(variedA==variedB,"BassMono modulation depends on block boundaries");for(auto sample:variedA)require(std::abs(sample[0])<1,"BassMono parameter ramp unstable");
  bassMono.prepare(sr,120,1);require(rms(run(bassMono,Signal(8192,{0,0}),127))==0,"BassMono silence");
  std::cout<<"BassMono sr="<<sr<<" side at 30/120/1200Hz dB="<<20*std::log10(ratios[0])<<"/"<<20*std::log10(ratios[1])<<"/"<<20*std::log10(ratios[2])<<"; mono/unity/modulation passed\n";
  Enhancer en,enB;en.prepare(sr,512,11,20,-1);enB.prepare(sr,512,11,20,-1);
  auto enh=run(en,input,63),enhB=run(enB,input,512);for(size_t i=0;i<enh.size();++i)require(std::abs(enh[i][0]-enhB[i][0])<1.e-6,"Enhancer block invariance");
  en.prepare(sr,512,0,0,0);auto neutral=run(en,input,127);double enhError=0;for(size_t i=input.size()/2;i<input.size();++i)enhError+=std::pow(neutral[i][0]-input[i-en.latency()][0],2);require(std::sqrt(enhError/(input.size()/2))<.001,"Enhancer dry latency");
  en.prepare(sr,512,11,20,-1);require(rms(run(en,Signal(8192,{0,0}),63))==0,"Enhancer silence");
  en.prepare(sr,512,11,0,0);auto lowIn=tone(sr,15),lowOut=run(en,lowIn,127);require(std::abs(20*std::log10(rms(lowOut)/rms(lowIn))-.66)<.03,"Enhancer low shelf");
  // Independent non-oversampled GoldenTips reference at its default settings.
  for(double hz:{70.,316.,1000.,4200.,7800.,12000.}){
   auto source=tone(sr,hz,.1),reference=source;Biquad low,high,pass;low.set(0,sr,70,.66,std::sqrt(.5));high.set(2,sr,7800,.7,std::sqrt(.5));pass.set(3,sr,4200,0,.8);
   for(auto& sample:reference){const double x=high.tick(low.tick(sample[0])),band=pass.tick(x);sample[0]=float((x+.036*std::tanh(2.4*band)/std::tanh(2.4))*std::pow(10.,-1./20));}
   en.prepare(sr,512,11,20,-1);const auto measured=run(en,source,127);require(std::abs(20*std::log10(rms(measured)/rms(reference)))<.2,"Enhancer differs from GoldenTips reference >0.2dB");
  }
  en.prepare(sr,512,11,20,-1);en.target(100,100,6);run(en,tone(sr,8000,.8),31);
  im.prepare(sr,1.4,1,120,1,1,0);auto fullWide=run(im,input,127);const double midGain=std::pow(10.,1./20.);for(size_t i=0;i<input.size();++i){double m=(input[i][0]+input[i][1])*.5*midGain,s=(input[i][0]-input[i][1])*.5*1.4;require(std::abs(fullWide[i][0]-(m+s))<1.e-7&&std::abs(fullWide[i][1]-(m-s))<1.e-7,"Full-band M/S equation");}
  std::cout<<"Enhancer shelves/silence/latency/block and full-band stereo passed sr="<<sr<<"\n";
  Limiter limiter;limiter.prepare(sr,257,{18,-3,100,0,0});auto limited=run(limiter,tone(sr,997,.7),513);double peak=0;for(const auto& x:limited){peak=std::max(peak,std::abs(double(x[0])));require(std::abs(x[1]-.5*x[0])<2.e-6,"Limiter stereo link");}require(peak<=std::pow(10.,-3./20)+1.e-6,"Limiter ceiling");require(peak>.5,"Limiter excessively attenuated");require(limiter.latency()>int(sr*.005),"Limiter latency missing oversampling");
  Limiter a,b;a.prepare(sr,512,{12,-1,100,0,0});b.prepare(sr,512,{12,-1,100,0,0});auto x=run(a,input,63),y=run(b,input,512);double blockError=0;for(size_t i=0;i<x.size();++i)blockError=std::max(blockError,std::abs(double(x[i][0]-y[i][0])));require(blockError<1.e-6,"Limiter depends on host block");
  std::cout<<"sr="<<sr<<" EQ 8 bands / mono / ceiling / latency / block invariance passed; peak="<<peak<<" latency="<<limiter.latency()<<"\n";
 }
 return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}}

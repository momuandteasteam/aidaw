// SPDX-License-Identifier: AGPL-3.0-only
#pragma once
#include <juce_dsp/juce_dsp.h>
#include <array>
#include <vector>
namespace aidawfx {
struct Smooth {
 double value=0,target=0,step=0; int left=0,length=960;
 void reset(double rate,double v){length=std::max(1,int(rate*.02));value=target=v;left=0;}
 void set(double v){if(v!=target){target=v;left=length;step=(target-value)/left;}}
 double next(){if(left>0){value+=step;if(--left==0)value=target;}return value;}
};
struct Biquad {
 double b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
 void reset(){z1=z2=0;}
 double tick(double x){const double y=b0*x+z1;z1=b1*x-a1*y+z2;z2=b2*x-a2*y;return y;}
 void set(int type,double sr,double hz,double db,double q){
  const double w=juce::MathConstants<double>::twoPi*std::clamp(hz,10.,sr*.45)/sr,c=std::cos(w),s=std::sin(w),A=std::pow(10.,db/40.),alpha=s/(2*q),beta=2*std::sqrt(A)*alpha;
  double a0;
  if(type==0){b0=A*((A+1)-(A-1)*c+beta);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-beta);a0=(A+1)+(A-1)*c+beta;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-beta;}
  else if(type==1){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
  else if(type==2){b0=A*((A+1)+(A-1)*c+beta);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-beta);a0=(A+1)-(A-1)*c+beta;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-beta;}
  else if(type==4){b0=(1-c)/2;b1=1-c;b2=b0;a0=1+alpha;a1=-2*c;a2=1-alpha;}
  else {b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+alpha;a1=-2*c;a2=1-alpha;}
  b0/=a0;b1/=a0;b2/=a0;a1/=a0;a2/=a0;
 }
};
struct EQ {
 std::array<Smooth,22> p; Biquad f[2][8];double sr=48000;int phase=0;
 void prepare(double rate,const std::array<double,22>& v){sr=rate;phase=0;for(int j=0;j<22;++j)p[j].reset(rate,v[j]);for(auto& c:f)for(auto& b:c)b.reset();}
 void target(const std::array<double,22>& v){for(int j=0;j<22;++j)p[j].set(v[j]);}
 void process(juce::AudioBuffer<float>& b){for(int i=0;i<b.getNumSamples();++i){double v[22];for(int j=0;j<22;++j)v[j]=p[j].next();if(phase++%16==0)for(auto& c:f){c[0].set(0,sr,v[0],v[1],.7071067811865476);c[1].set(1,sr,v[2],v[3],v[4]);c[7].set(2,sr,v[5],v[6],.7071067811865476);for(int k=0;k<5;++k)c[k+2].set(1,sr,v[7+k*3],v[8+k*3],v[9+k*3]);}for(int c=0;c<2;++c){double x=b.getSample(c,i);for(auto& filter:f[c])x=filter.tick(x);b.setSample(c,i,float(x));}}}
};
struct Imager {
 Smooth width,bass,hz,full,midDb,sideDb;double sr=48000,low1=0,low2=0;
 void prepare(double rate,double w,double b,double h,double mode=0,double mid=0,double side=0){full.reset(rate,mode);midDb.reset(rate,mid);sideDb.reset(rate,side);sr=rate;width.reset(rate,w);bass.reset(rate,b);hz.reset(rate,h);low1=low2=0;}
 void target(double w,double b,double h,double mode=0,double mid=0,double side=0){width.set(w);bass.set(b);hz.set(h);full.set(mode);midDb.set(mid);sideDb.set(side);}
 void process(juce::AudioBuffer<float>& b){for(int i=0;i<b.getNumSamples();++i){double l=b.getSample(0,i),r=b.getSample(1,i),m=(l+r)*.5,s=(l-r)*.5;
 const double a=1-std::exp(-juce::MathConstants<double>::twoPi*hz.next()/sr);low1+=a*(s-low1);double high=s-low1;low2+=a*(high-low2);high-=low2;const double w=width.next(),split=high*w+(s-high)*bass.next(),mode=full.next(),side=(split+mode*(s*w-split))*std::pow(10.,sideDb.next()/20.);m*=std::pow(10.,midDb.next()/20.);b.setSample(0,i,float(m+side));b.setSample(1,i,float(m-side));}}
};
// Preserve Mid exactly; only attenuate low-frequency Side. No split/recombine on Mid.
struct Gain {
 Smooth db;
 void prepare(double rate,double value){db.reset(rate,value);}
 void target(double value){db.set(value);}
 void process(juce::AudioBuffer<float>& b){for(int i=0;i<b.getNumSamples();++i){const double multiplier=std::pow(10.,db.next()/20.);for(int c=0;c<2;++c)b.setSample(c,i,float(double(b.getSample(c,i))*multiplier));}}
};
struct BassMono {
 Smooth hz,amount;Biquad high[2];double sr=48000;int phase=0;
 void prepare(double rate,double h,double a){sr=rate;hz.reset(rate,h);amount.reset(rate,a);phase=0;for(auto& f:high)f.reset();}
 void target(double h,double a){hz.set(h);amount.set(a);}
 void process(juce::AudioBuffer<float>& b){
  for(int i=0;i<b.getNumSamples();++i){const double frequency=hz.next(),mix=amount.next();
   if(phase++%16==0){high[0].set(3,sr,frequency,0,.541196100146197);high[1].set(3,sr,frequency,0,1.306562964876377);}
   const double l=b.getSample(0,i),r=b.getSample(1,i),mid=(l+r)*.5,side=(l-r)*.5;
   const double filtered=high[1].tick(high[0].tick(side)),result=side+mix*(filtered-side);
   b.setSample(0,i,float(mid+result));b.setSample(1,i,float(mid-result));
  }
 }
};
// GoldenTips tone and parallel high-band saturation, with antialiasing.
class Enhancer {
public:
 Enhancer():os(2,2,juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple,true,true){}
 void prepare(double rate,int block,double low=11,double process=20,double output=-1){
  sr=rate;blockSize=std::max(1,block);os.initProcessing(size_t(blockSize));os.reset();phase=0;
  contour.reset(rate,low);toneProcess.reset(rate,process);saturation.reset(rate*4,process);gain.reset(rate*4,output);
  for(int c=0;c<2;++c){shelf[c][0].reset();shelf[c][1].reset();hp[c].reset();hp[c].set(3,rate*4,4200,0,.8);}
 }
 int latency()const{return int(std::round(os.getLatencyInSamples()));}
 void target(double low,double process,double output){contour.set(low);toneProcess.set(process);saturation.set(process);gain.set(output);}
 void process(juce::AudioBuffer<float>& buffer){
  juce::dsp::AudioBlock<float> full(buffer);
  for(size_t offset=0;offset<full.getNumSamples();){
   const size_t count=std::min(size_t(blockSize),full.getNumSamples()-offset);auto sub=full.getSubBlock(offset,count);
   for(size_t i=0;i<count;++i){const double lo=contour.next(),hi=toneProcess.next();
    if(phase++%16==0)for(int c=0;c<2;++c){shelf[c][0].set(0,sr,70,lo*.06,std::sqrt(.5));shelf[c][1].set(2,sr,7800,hi*.035,std::sqrt(.5));}
    for(int c=0;c<2;++c)sub.setSample(c,i,float(shelf[c][1].tick(shelf[c][0].tick(sub.getSample(c,i)))));
   }
   auto up=os.processSamplesUp(sub);
   for(size_t i=0;i<up.getNumSamples();++i){const double amount=saturation.next(),drive=1+amount*.07,out=std::pow(10.,gain.next()/20.);
    for(int c=0;c<2;++c){const double x=up.getSample(c,i),band=hp[c].tick(x);up.setSample(c,i,float((x+amount*.0018*std::tanh(drive*band)/std::tanh(drive))*out));}
   }
   os.processSamplesDown(sub);offset+=count;
  }
 }
private:
 juce::dsp::Oversampling<float> os;Smooth contour,toneProcess,saturation,gain;Biquad shelf[2][2],hp[2];double sr=48000;int blockSize=512,phase=0;
};
class Limiter {
public:
 Limiter():os(2,2,juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple,true,true){}
 void prepare(double rate,int block,const std::array<double,5>& values){
  sr=rate*4;blockSize=std::max(1,block);os.initProcessing(size_t(blockSize));os.reset();
  for(int j=0;j<5;++j)p[j].reset(sr,values[j]);index=0;envelope=1;
  ahead=std::max(1,int(std::round(rate*.005)))*4;ringSize=ahead+2;delay.assign(size_t(ringSize)*2,0);queue.assign(size_t(ringSize),{});head=tail=0;
 }
 int latency() const{return int(std::round(os.getLatencyInSamples()))+ahead/4;}
 void target(const std::array<double,5>& values){for(int j=0;j<5;++j)p[j].set(values[j]);}
 void process(juce::AudioBuffer<float>& buffer){
  juce::dsp::AudioBlock<float> full(buffer);
  for(size_t offset=0;offset<full.getNumSamples();){const size_t count=std::min(size_t(blockSize),full.getNumSamples()-offset);auto sub=full.getSubBlock(offset,count);auto up=os.processSamplesUp(sub);
   for(size_t i=0;i<up.getNumSamples();++i){double v[5];for(int j=0;j<5;++j)v[j]=p[j].next();
    {const double drive=std::pow(10.,v[0]/20),cap=std::pow(10.,v[1]/20)*.97,release=std::exp(-1/(sr*v[2]*.001)),attack=std::exp(-1/(sr*.0002));
     double peak=0;for(int c=0;c<2;++c){const double x=up.getSample(c,i)*drive;delay[size_t(index%ringSize)*2+c]=float(x);peak=std::max(peak,std::abs(x));}
     while(head!=tail&&queue[head].time<index-ahead)head=(head+1)%ringSize;
     while(head!=tail&&queue[(tail+ringSize-1)%ringSize].value<=peak)tail=(tail+ringSize-1)%ringSize;
     queue[tail]={index,peak};tail=(tail+1)%ringSize;
     const double desired=std::min(1.,cap/std::max(1.e-20,queue[head].value));envelope=desired+(envelope-desired)*(desired<envelope?attack:release);
     double x[2]={0,0};if(index>=ahead)for(int c=0;c<2;++c)x[c]=delay[size_t((index-ahead)%ringSize)*2+c]*envelope;
     const double guard=std::min(1.,cap/std::max({1.e-20,std::abs(x[0]),std::abs(x[1])}));for(int c=0;c<2;++c)up.setSample(c,i,float(x[c]*guard));++index;
    }
   }
   os.processSamplesDown(sub);
   {const double cap=std::pow(10.,p[1].value/20);for(size_t i=0;i<count;++i){const double peak=std::max(std::abs(sub.getSample(0,i)),std::abs(sub.getSample(1,i)));const float g=float(std::min(1.,cap/std::max(1.e-20,peak)));for(int c=0;c<2;++c)sub.setSample(c,i,sub.getSample(c,i)*g);}}
   offset+=count;
  }
 }
private:
 struct Peak{int64_t time=0;double value=0;};
 juce::dsp::Oversampling<float> os;std::array<Smooth,5> p;
 double sr=192000,envelope=1;int blockSize=512,ahead=960,ringSize=962,head=0,tail=0;int64_t index=0;std::vector<float> delay;std::vector<Peak> queue;
};
}

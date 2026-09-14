# Standard pack: built locally, never installed into the user's system plugin folders.
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/starter-source")
file(DOWNLOAD
  https://raw.githubusercontent.com/schellingb/TinySoundFont/853a0a171759f1ddba0de1442133a75912bbeffa/tsf.h
  "${CMAKE_BINARY_DIR}/starter-source/tsf.h"
  EXPECTED_HASH SHA256=70d55963c98f60ebb81518eaa1f25d46888d5180eb5f5289fd6b74ffc177d197
  TLS_VERIFY ON)
foreach(kind IN ITEMS GM EQ Limiter Reverb Imager BassMono Gain Enhancer)
  string(TOLOWER "${kind}" slug)
  if(kind STREQUAL "GM")
    set(synth TRUE)
    set(code Asgm)
  else()
    set(synth FALSE)
    if(kind STREQUAL "EQ")
      set(code Aseq)
    elseif(kind STREQUAL "Limiter")
      set(code Aslm)
    elseif(kind STREQUAL "Enhancer")
      set(code Aseh)
    elseif(kind STREQUAL "Gain")
      set(code Asgn)
    elseif(kind STREQUAL "BassMono")
      set(code Asbm)
    elseif(kind STREQUAL "Imager")
      set(code Asim)
    else()
      set(code Asrv)
    endif()
  endif()
  juce_add_plugin(aidaw-starter-${slug}
    VERSION ${PROJECT_VERSION}
    BUNDLE_ID "com.aidaw.plugins"
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE ${code}
    FORMATS VST3 PRODUCT_NAME "AIDAW ${kind}"
    IS_SYNTH ${synth} NEEDS_MIDI_INPUT ${synth} COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-starter-${slug} PRIVATE StarterPlugin.cpp)
  target_include_directories(aidaw-starter-${slug} PRIVATE "${CMAKE_BINARY_DIR}/starter-source")
  target_compile_definitions(aidaw-starter-${slug} PUBLIC
    AIDAW_STARTER_${kind}=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-starter-${slug} PRIVATE juce::juce_dsp juce::juce_audio_utils juce::juce_cryptography juce::juce_recommended_config_flags)
endforeach()

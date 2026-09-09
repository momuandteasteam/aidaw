cmake_minimum_required(VERSION 3.22)
project(aidaw VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/utf-8)
endif()
if(APPLE)
  enable_language(OBJC OBJCXX)
endif()
include(FetchContent)
FetchContent_Declare(JUCE
  URL https://github.com/juce-framework/JUCE/archive/7c9d3783b127263d72bb65fe0a7e2dc8a02a7ac2.tar.gz
  URL_HASH SHA256=488c4f6e2c121316d60801842dba87c44e5dbad4e661cb49bf806b49a38b6a5e
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(JUCE)

juce_add_console_app(aidaw-engine PRODUCT_NAME "aidaw-engine")
target_sources(aidaw-engine PRIVATE native/main.cpp)
target_compile_definitions(aidaw-engine PRIVATE
  JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=$<BOOL:${APPLE}> JUCE_PLUGINHOST_LADSPA=0
  JUCE_MODAL_LOOPS_PERMITTED=1)
target_link_libraries(aidaw-engine PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
if(WIN32)
  target_link_libraries(aidaw-engine PRIVATE ole32 shell32)
endif()
set_target_properties(aidaw-engine PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin")

# Standard pack: built locally, never installed into the user's system plugin folders.
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/starter-source")
file(DOWNLOAD
  https://raw.githubusercontent.com/schellingb/TinySoundFont/853a0a171759f1ddba0de1442133a75912bbeffa/tsf.h
  "${CMAKE_BINARY_DIR}/starter-source/tsf.h"
  EXPECTED_HASH SHA256=70d55963c98f60ebb81518eaa1f25d46888d5180eb5f5289fd6b74ffc177d197
  TLS_VERIFY ON)
foreach(kind IN ITEMS GM EQ Limiter Reverb)
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
    else()
      set(code Asrv)
    endif()
  endif()
  juce_add_plugin(aidaw-starter-${slug}
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE ${code}
    FORMATS VST3 PRODUCT_NAME "AIDAW ${kind}"
    IS_SYNTH ${synth} NEEDS_MIDI_INPUT ${synth} COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-starter-${slug} PRIVATE native/StarterPlugin.cpp)
  target_include_directories(aidaw-starter-${slug} PRIVATE "${CMAKE_BINARY_DIR}/starter-source")
  target_compile_definitions(aidaw-starter-${slug} PUBLIC
    AIDAW_STARTER_${kind}=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-starter-${slug} PRIVATE juce::juce_audio_utils juce::juce_cryptography juce::juce_recommended_config_flags)
endforeach()

option(AIDAW_BUILD_TEST_PLUGIN "Build local test instruments without installing them" ON)
if(AIDAW_BUILD_TEST_PLUGIN)
  set(test_formats VST3)
  if(APPLE)
    list(APPEND test_formats AU)
  endif()
  juce_add_plugin(aidaw-test-instrument
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE Aits
    FORMATS ${test_formats} PRODUCT_NAME "AIDAW Test Instrument"
    IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-test-instrument PRIVATE native/TestPlugin.cpp)
  target_compile_definitions(aidaw-test-instrument PUBLIC
    JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-test-instrument PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
  juce_add_plugin(aidaw-test-effect
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE Aief
    FORMATS VST3 PRODUCT_NAME "AIDAW Test Effect"
    IS_SYNTH FALSE NEEDS_MIDI_INPUT FALSE COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-test-effect PRIVATE native/TestPlugin.cpp)
  target_compile_definitions(aidaw-test-effect PUBLIC
    AIDAW_TEST_EFFECT=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-test-effect PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()

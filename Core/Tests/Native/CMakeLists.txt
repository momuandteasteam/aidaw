option(AIDAW_BUILD_TEST_PLUGIN "Build local test instruments without installing them" ON)
if(AIDAW_BUILD_TEST_PLUGIN)
  set(test_formats VST3)
  if(APPLE)
    list(APPEND test_formats AU)
  endif()
  juce_add_plugin(aidaw-test-instrument
    BUNDLE_ID "com.aidaw.plugins"
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE Aits
    FORMATS ${test_formats} PRODUCT_NAME "AIDAW Test Instrument"
    IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-test-instrument PRIVATE TestPlugin.cpp)
  target_compile_definitions(aidaw-test-instrument PUBLIC
    JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-test-instrument PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
  juce_add_plugin(aidaw-test-effect
    BUNDLE_ID "com.aidaw.plugins"
    COMPANY_NAME "AIDAW" PLUGIN_MANUFACTURER_CODE Aida PLUGIN_CODE Aief
    FORMATS VST3 PRODUCT_NAME "AIDAW Test Effect"
    IS_SYNTH FALSE NEEDS_MIDI_INPUT FALSE COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(aidaw-test-effect PRIVATE TestPlugin.cpp)
  target_compile_definitions(aidaw-test-effect PUBLIC
    AIDAW_TEST_EFFECT=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(aidaw-test-effect PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()

juce_add_console_app(aidaw-effect-dsp-tests PRODUCT_NAME "AIDAW DSP checks")
target_sources(aidaw-effect-dsp-tests PRIVATE EffectDSPTest.cpp)
target_compile_definitions(aidaw-effect-dsp-tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(aidaw-effect-dsp-tests PRIVATE juce::juce_dsp juce::juce_recommended_config_flags)
set_target_properties(aidaw-effect-dsp-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set_target_properties(aidaw-effect-dsp-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin" RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin")

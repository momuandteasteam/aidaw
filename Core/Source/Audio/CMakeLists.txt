juce_add_console_app(aidaw-engine PRODUCT_NAME "aidaw-engine")
target_sources(aidaw-engine PRIVATE main.cpp)
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

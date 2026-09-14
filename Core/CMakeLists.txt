cmake_minimum_required(VERSION 3.22)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package.json" AIDAW_PACKAGE_JSON)
string(JSON AIDAW_RELEASE_VERSION GET "${AIDAW_PACKAGE_JSON}" version)
project(aidaw VERSION ${AIDAW_RELEASE_VERSION} LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
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

add_subdirectory(Source/Audio engine)
add_subdirectory(Source/StarterPlugins starter)
add_subdirectory(Tests/Native test-fixtures)

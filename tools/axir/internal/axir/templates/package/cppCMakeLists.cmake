cmake_minimum_required(VERSION 3.16)
project(axllm VERSION {{AX_VERSION}} LANGUAGES CXX)

option(AX_BUILD_EXAMPLES "Build generated Ax examples" ON)
option(AX_BUILD_CONFORMANCE "Build generated Ax conformance runner" ON)
option(AX_BUILD_QUICKJS_PROFILE "Build optional QuickJS runtime profile" OFF)
set(AX_QUICKJS_CFLAGS "" CACHE STRING "Extra compile flags for the optional QuickJS runtime profile")
set(AX_QUICKJS_LDFLAGS "" CACHE STRING "Extra link flags or libraries for the optional QuickJS runtime profile")
option(AXLLM_ENABLE_CURL "Build the built-in libcurl HTTP transport" ON)
option(AXLLM_ENABLE_MCP_OPENSSL "Use OpenSSL for MCP PKCE helpers when available" ON)
option(AXLLM_ENABLE_MCP_STDIO_BOOST "Use Boost.Process for MCP stdio process transport when available" OFF)
option(AXLLM_ENABLE_REALTIME "Build the built-in IXWebSocket realtime audio transport" OFF)

add_library(axllm axllm/axllm.cpp axllm/mcp.cpp)
add_library(axllm::axllm ALIAS axllm)
target_compile_features(axllm PUBLIC cxx_std_17)
target_include_directories(axllm PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
  $<INSTALL_INTERFACE:include>
)

set(AXLLM_CONFIG_USES_CURL OFF)
if(AXLLM_ENABLE_CURL)
  find_package(CURL QUIET)
  if(CURL_FOUND)
    target_link_libraries(axllm PUBLIC CURL::libcurl)
    target_compile_definitions(axllm PUBLIC AXLLM_ENABLE_CURL=1)
    set(AXLLM_CONFIG_USES_CURL ON)
  else()
    message(WARNING "libcurl was not found; axllm will build, but built-in provider HTTP will throw unless a custom Transport is supplied.")
  endif()
endif()

if(AXLLM_ENABLE_REALTIME)
  include(FetchContent)
  set(USE_TLS ON CACHE BOOL "" FORCE)
  FetchContent_Declare(
    ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG v11.4.5
  )
  FetchContent_MakeAvailable(ixwebsocket)
  target_link_libraries(axllm PUBLIC ixwebsocket)
  target_compile_definitions(axllm PUBLIC AXLLM_ENABLE_REALTIME=1)
endif()

if(AXLLM_ENABLE_MCP_OPENSSL)
  set(AXLLM_CONFIG_USES_OPENSSL OFF)
  find_package(OpenSSL QUIET)
  if(OpenSSL_FOUND)
    target_link_libraries(axllm PUBLIC OpenSSL::Crypto)
    target_compile_definitions(axllm PUBLIC AXLLM_ENABLE_OPENSSL=1)
    set(AXLLM_CONFIG_USES_OPENSSL ON)
  else()
    message(WARNING "OpenSSL was not found; MCP PKCE helpers use the portable fallback.")
  endif()
endif()

if(AXLLM_ENABLE_MCP_STDIO_BOOST)
  find_package(Boost QUIET COMPONENTS process)
  if(Boost_FOUND)
    target_link_libraries(axllm PUBLIC Boost::process)
    target_compile_definitions(axllm PUBLIC AXLLM_ENABLE_BOOST_PROCESS=1)
  else()
    message(FATAL_ERROR "AXLLM_ENABLE_MCP_STDIO_BOOST=ON requires Boost.Process.")
  endif()
endif()

if(AX_BUILD_EXAMPLES)
  foreach(example
    signature_schema
    axgen_scripted_client_tool
    axgen_openai_api
    provider_mapping_no_key
    adaptive_balancer_no_key
    provider_stream_no_key
    runtime_adapter
    runtime_protocol
    axflow_program_graph
    flow_openai_api
    audio_responses_mapping
    realtime_audio_events
    optimizer_artifact
    gepa_local_optimizer
    mcp_scripted_tools
  )
    add_executable(${example} examples/${example}.cpp)
    target_link_libraries(${example} PRIVATE axllm::axllm)
  endforeach()
endif()

if(AX_BUILD_CONFORMANCE)
  add_executable(ax_conformance conformance.cpp)
  target_link_libraries(ax_conformance PRIVATE axllm::axllm)
endif()

if(AX_BUILD_QUICKJS_PROFILE)
  if(AX_QUICKJS_CFLAGS STREQUAL "" OR AX_QUICKJS_LDFLAGS STREQUAL "")
    message(FATAL_ERROR "AX_BUILD_QUICKJS_PROFILE=ON requires AX_QUICKJS_CFLAGS and AX_QUICKJS_LDFLAGS for host QuickJS headers/libraries.")
  endif()
  separate_arguments(AX_QUICKJS_CFLAGS_LIST NATIVE_COMMAND "${AX_QUICKJS_CFLAGS}")
  separate_arguments(AX_QUICKJS_LDFLAGS_LIST NATIVE_COMMAND "${AX_QUICKJS_LDFLAGS}")
  add_library(axllm_quickjs axllm/runtime/quickjs/quickjs_runtime.cpp)
  add_library(axllm::quickjs ALIAS axllm_quickjs)
  target_compile_features(axllm_quickjs PUBLIC cxx_std_17)
  target_include_directories(axllm_quickjs PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
    $<INSTALL_INTERFACE:include>
  )
  target_compile_options(axllm_quickjs PRIVATE ${AX_QUICKJS_CFLAGS_LIST})
  target_link_libraries(axllm_quickjs PUBLIC axllm::axllm ${AX_QUICKJS_LDFLAGS_LIST})
  if(AX_BUILD_EXAMPLES)
    add_executable(javascript_quickjs examples/runtime_profiles/javascript_quickjs.cpp)
    target_link_libraries(javascript_quickjs PRIVATE axllm::quickjs)
  endif()
endif()

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

install(TARGETS axllm EXPORT axllmTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
if(TARGET axllm_quickjs)
  install(TARGETS axllm_quickjs EXPORT axllmTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  )
endif()
install(DIRECTORY axllm/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/axllm
  FILES_MATCHING PATTERN "*.hpp"
)
install(EXPORT axllmTargets
  NAMESPACE axllm::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/axllm
)
configure_package_config_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/cmake/axllmConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/axllmConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/axllm
)
write_basic_package_version_file(
  ${CMAKE_CURRENT_BINARY_DIR}/axllmConfigVersion.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion
)
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/axllmConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/axllmConfigVersion.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/axllm
)

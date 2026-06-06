cmake_minimum_required(VERSION 3.16)
project(axllm VERSION 22.0.2 LANGUAGES CXX)

option(AX_BUILD_EXAMPLES "Build generated Ax examples" ON)
option(AX_BUILD_CONFORMANCE "Build generated Ax conformance runner" ON)
option(AX_BUILD_QUICKJS_PROFILE "Build optional QuickJS runtime profile" OFF)
option(AXLLM_ENABLE_CURL "Build the built-in libcurl HTTP transport" ON)

add_library(axllm axllm/axllm.cpp)
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

if(AX_BUILD_EXAMPLES)
  foreach(example
    signature_schema
    axgen_fake_client_tool
    axgen_openai_api
    axai_fake_transport
    axagent_pipeline
    runtime_adapter
    runtime_protocol
    axflow_program_graph
    optimizer_artifact
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
  message(FATAL_ERROR "QuickJS profile builds require host-provided QuickJS include/library flags; use examples/runtime_profiles/README.md.")
endif()

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

install(TARGETS axllm EXPORT axllmTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
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

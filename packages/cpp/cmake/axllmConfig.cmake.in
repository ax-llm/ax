@PACKAGE_INIT@

include(CMakeFindDependencyMacro)
if(@AXLLM_CONFIG_USES_CURL@)
  find_dependency(CURL)
endif()
if(@AXLLM_CONFIG_USES_OPENSSL@)
  find_dependency(OpenSSL)
endif()
include("${CMAKE_CURRENT_LIST_DIR}/axllmTargets.cmake")

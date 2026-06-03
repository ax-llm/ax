package axir

const pyProjectToml = `[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "axllm"
version = "{{AX_VERSION}}"
description = "Generated Ax runtime library"
readme = "README.md"
requires-python = ">=3.10"
license = { text = "MIT" }
authors = [{ name = "Ax" }]
dependencies = []
classifiers = [
  "Programming Language :: Python :: 3",
  "Programming Language :: Python :: 3 :: Only",
  "Programming Language :: Python :: 3.10",
  "Typing :: Typed",
]

[tool.setuptools.packages.find]
include = ["axllm", "axllm.*"]

[tool.setuptools.package-data]
axllm = ["py.typed"]
`

const pyManifestIn = `include README.md axir-capabilities.json
recursive-include examples *.py *.md *.json *.sh
include axllm/py.typed
`

const javaPomXML = `<project xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.axllm</groupId>
  <artifactId>ax</artifactId>
  <version>{{AX_VERSION}}</version>
  <name>Ax</name>
  <description>Generated Ax runtime library.</description>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <build>
    <sourceDirectory>${project.basedir}</sourceDirectory>
    <resources>
      <resource>
        <directory>${project.basedir}</directory>
        <includes>
          <include>axir-capabilities.json</include>
        </includes>
      </resource>
    </resources>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <release>17</release>
          <includes>
            <include>dev/axllm/ax/*.java</include>
          </includes>
          <excludes>
            <exclude>dev/axllm/ax/runtime/quickjs/**</exclude>
            <exclude>examples/**</exclude>
          </excludes>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`

const javaBuildGradle = `plugins {
  id 'java-library'
}

group = 'dev.axllm'
version = '{{AX_VERSION}}'

java {
  toolchain {
    languageVersion = JavaLanguageVersion.of(17)
  }
}

sourceSets {
  main {
    java {
      srcDirs = ['.']
      include 'dev/axllm/ax/*.java'
      exclude 'dev/axllm/ax/runtime/quickjs/**'
      exclude 'examples/**'
    }
    resources {
      srcDirs = ['.']
      include 'axir-capabilities.json'
    }
  }
}
`

const javaSettingsGradle = `pluginManagement {
  repositories {
    gradlePluginPortal()
    mavenCentral()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    mavenCentral()
  }
}

rootProject.name = 'ax'
`

const cppCMakeLists = `cmake_minimum_required(VERSION 3.16)
project(axllm VERSION {{AX_VERSION}} LANGUAGES CXX)

option(AX_BUILD_EXAMPLES "Build generated Ax examples" ON)
option(AX_BUILD_CONFORMANCE "Build generated Ax conformance runner" ON)
option(AX_BUILD_QUICKJS_PROFILE "Build optional QuickJS runtime profile" OFF)

add_library(axllm axllm/axllm.cpp)
add_library(axllm::axllm ALIAS axllm)
target_compile_features(axllm PUBLIC cxx_std_17)
target_include_directories(axllm PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
  $<INSTALL_INTERFACE:include>
)

if(AX_BUILD_EXAMPLES)
  foreach(example
    signature_schema
    axgen_fake_client_tool
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
`

const cppCMakeConfig = `@PACKAGE_INIT@

include("${CMAKE_CURRENT_LIST_DIR}/axllmTargets.cmake")
`

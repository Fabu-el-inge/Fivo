# Fivo Core Library

# Collect sources
file(GLOB_RECURSE SOURCES "src/*.cpp")
file(GLOB_RECURSE HEADERS "include/*.h")

add_library(fivo_core SHARED ${SOURCES} ${HEADERS})

# Include directories
target_include_directories(fivo_core PUBLIC 
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# For static linking scenarios (optional alias)
add_library(Fivo::Core ALIAS fivo_core)

# Compiler options
if(MSVC)
    target_compile_options(fivo_core PRIVATE /W4)
else()
    target_compile_options(fivo_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

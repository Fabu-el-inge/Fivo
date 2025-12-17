# Fivo CLI Demo

add_executable(fivo_demo cli_main.cpp)

target_link_libraries(fivo_demo PRIVATE fivo_core)

target_include_directories(fivo_demo PRIVATE
    ${CMAKE_SOURCE_DIR}/core/include
)

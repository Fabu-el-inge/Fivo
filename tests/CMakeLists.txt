# Tests

enable_testing()

add_executable(fivo_tests test_main.cpp)

target_link_libraries(fivo_tests PRIVATE fivo_core)

# Simple test execution
add_test(NAME CoreTests COMMAND fivo_tests)

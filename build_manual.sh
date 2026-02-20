#!/bin/bash
set -e

echo "Compiling Fivo Core..."
mkdir -p build/bin

# Compile Core Object Files
clang++ -std=c++17 -c core/src/music_theory.cpp -I core/include -o build/music_theory.o
clang++ -std=c++17 -c core/src/chord_engine.cpp -I core/include -o build/chord_engine.o
clang++ -std=c++17 -c core/src/circle_engine.cpp -I core/include -o build/circle_engine.o
clang++ -std=c++17 -c core/src/style_manager.cpp -I core/include -o build/style_manager.o
clang++ -std=c++17 -c core/src/fivo_api.cpp -I core/include -o build/fivo_api.o

# Create Dynamic Library (dylib for Mac)
clang++ -dynamiclib -o build/bin/libfivo.dylib \
    build/music_theory.o \
    build/chord_engine.o \
    build/circle_engine.o \
    build/style_manager.o \
    build/fivo_api.o

echo "Compiling Tests..."
clang++ -std=c++17 tests/test_main.cpp -I core/include -L build/bin -lfivo -o build/bin/fivo_tests

echo "Compiling CLI Demo..."
clang++ -std=c++17 demos/cli_main.cpp -I core/include -L build/bin -lfivo -o build/bin/fivo_demo

echo "Running Tests..."
# Set library path so it finds libfivo.dylib
export DYLD_LIBRARY_PATH=./build/bin:$DYLD_LIBRARY_PATH
./build/bin/fivo_tests

#!/bin/bash
cd "$(dirname "$0")"
GPP=/c/msys64/mingw64/bin/g++.exe

echo "Compiling music_theory..."
$GPP -std=c++17 -c core/src/music_theory.cpp -I core/include -o build/music_theory.o || exit 1

echo "Compiling chord_engine..."
$GPP -std=c++17 -c core/src/chord_engine.cpp -I core/include -o build/chord_engine.o || exit 1

echo "Compiling circle_engine..."
$GPP -std=c++17 -c core/src/circle_engine.cpp -I core/include -o build/circle_engine.o || exit 1

echo "Compiling style_manager..."
$GPP -std=c++17 -c core/src/style_manager.cpp -I core/include -o build/style_manager.o || exit 1

echo "Compiling fivo_api..."
$GPP -std=c++17 -c core/src/fivo_api.cpp -I core/include -o build/fivo_api.o || exit 1

echo "Creating DLL..."
$GPP -shared -o build/bin/libfivo_core.dll build/music_theory.o build/chord_engine.o build/circle_engine.o build/style_manager.o build/fivo_api.o || exit 1

echo "Compiling demo..."
$GPP -std=c++17 demos/cli_main.cpp -I core/include -L build/bin -lfivo_core -o build/bin/fivo_demo.exe || exit 1

echo "BUILD SUCCESS"

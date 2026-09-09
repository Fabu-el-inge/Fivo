@echo off
cd /d "%~dp0"

echo Compilando...
C:\msys64\mingw64\bin\g++.exe -std=c++17 -O2 demos/cli_main.cpp core/src/music_theory.cpp core/src/chord_engine.cpp core/src/circle_engine.cpp core/src/style_manager.cpp core/src/fivo_api.cpp -I core/include -o fivo_test.exe

if exist fivo_test.exe (
    echo BUILD OK
    fivo_test.exe --json Am F --power
    move /Y fivo_test.exe build\bin\fivo_demo.exe
) else (
    echo BUILD FAILED
)

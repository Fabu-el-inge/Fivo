@echo off
setlocal enabledelayedexpansion

:: ===============================================
:: FIVO - Windows Build Script (Optimizado)
:: ===============================================

cd /d "%~dp0"
echo [FIVO] Building in: %CD%

:: Detectar compilador g++ automaticamente
set "GPP="
if exist "C:\msys64\mingw64\bin\g++.exe" (
    set "GPP=C:\msys64\mingw64\bin\g++.exe"
) else if exist "C:\mingw64\bin\g++.exe" (
    set "GPP=C:\mingw64\bin\g++.exe"
) else (
    where g++ >nul 2>&1 && set "GPP=g++"
)

if "%GPP%"=="" (
    echo [ERROR] No se encontro g++. Instala MinGW64 o agrega g++ al PATH.
    echo         Descarga: https://www.msys2.org/
    exit /b 1
)

echo [FIVO] Usando compilador: %GPP%

:: Crear directorios de build si no existen
if not exist "build" mkdir build
if not exist "build\bin" mkdir build\bin

echo.
echo [1/3] Compilando objetos del Core...

:: Compilar todos los objetos en paralelo usando start /b
start /b "" "%GPP%" -std=c++17 -O2 -c core/src/music_theory.cpp -I core/include -o build/music_theory.o
start /b "" "%GPP%" -std=c++17 -O2 -c core/src/chord_engine.cpp -I core/include -o build/chord_engine.o
start /b "" "%GPP%" -std=c++17 -O2 -c core/src/circle_engine.cpp -I core/include -o build/circle_engine.o
start /b "" "%GPP%" -std=c++17 -O2 -c core/src/style_manager.cpp -I core/include -o build/style_manager.o
start /b "" "%GPP%" -std=c++17 -O2 -c core/src/fivo_api.cpp -I core/include -o build/fivo_api.o

:: Esperar a que terminen las compilaciones (max 30 segundos)
echo     Esperando compilacion paralela...
:wait_loop
set "count=0"
for %%f in (build\music_theory.o build\chord_engine.o build\circle_engine.o build\style_manager.o build\fivo_api.o) do (
    if exist "%%f" set /a count+=1
)
if !count! lss 5 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

:: Verificar que todos los .o existen
set "missing=0"
for %%f in (music_theory chord_engine circle_engine style_manager fivo_api) do (
    if not exist "build\%%f.o" (
        echo [ERROR] Fallo compilando %%f.cpp
        set /a missing+=1
    )
)
if !missing! gtr 0 (
    echo [ERROR] Faltan !missing! archivos objeto.
    exit /b 1
)

echo     OK - 5 objetos compilados

echo.
echo [2/3] Creando DLL...
"%GPP%" -shared -O2 -o build/bin/libfivo_core.dll build/music_theory.o build/chord_engine.o build/circle_engine.o build/style_manager.o build/fivo_api.o
if errorlevel 1 (
    echo [ERROR] Fallo al crear DLL
    exit /b 1
)
echo     OK - libfivo_core.dll creada

echo.
echo [3/3] Compilando ejecutable demo...
"%GPP%" -std=c++17 -O2 demos/cli_main.cpp -I core/include -L build/bin -lfivo_core -o build/bin/fivo_demo.exe
if errorlevel 1 (
    echo [ERROR] Fallo al crear ejecutable
    exit /b 1
)
echo     OK - fivo_demo.exe creado

echo.
echo ===============================================
echo [FIVO] BUILD COMPLETADO EXITOSAMENTE
echo ===============================================
echo   DLL: build\bin\libfivo_core.dll
echo   EXE: build\bin\fivo_demo.exe
echo.
echo Para probar: build\bin\fivo_demo.exe --json C G
echo.

:: Limpiar archivos objeto temporales
del /q build\*.o 2>nul

exit /b 0

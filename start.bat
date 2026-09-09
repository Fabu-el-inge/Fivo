@echo off
setlocal

:: ===============================================
:: FIVO - Script de Inicio Completo (Windows)
:: ===============================================

cd /d "%~dp0"
echo.
echo ===== FIVO - Iniciando Proyecto =====
echo.

:: Verificar si el core C++ esta compilado
if not exist "build\bin\fivo_demo.exe" (
    echo [!] Core C++ no compilado. Compilando...
    call build_windows.bat
    if errorlevel 1 (
        echo [ERROR] Fallo la compilacion del Core C++
        echo         Verifica que tengas MinGW64 instalado
        pause
        exit /b 1
    )
    echo.
)

:: Verificar node_modules del BFF
if not exist "bff\node_modules" (
    echo [!] Instalando dependencias del BFF...
    cd bff
    call npm install
    cd ..
    echo.
)

:: Verificar node_modules del frontend
if not exist "frontend\node_modules" (
    echo [!] Instalando dependencias del Frontend...
    cd frontend
    call npm install
    cd ..
    echo.
)

echo [OK] Todo listo. Iniciando servidores...
echo.
echo     Backend  -> http://localhost:3001
echo     Frontend -> http://localhost:5173
echo.
echo     Presiona Ctrl+C para detener
echo.

:: Iniciar backend en nueva ventana
start "FIVO Backend" cmd /k "cd /d "%~dp0bff" && node server.js"

:: Esperar un momento para que el backend arranque
timeout /t 2 /nobreak >nul

:: Iniciar frontend en esta ventana
cd frontend
call npm run dev

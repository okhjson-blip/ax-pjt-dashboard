@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  AI 프로젝트 통합 대시보드 시작
echo.

if not exist "node_modules\" (
  echo  의존성 설치 중...
  call npm install
  if errorlevel 1 (
    echo  npm install 실패. Node.js가 설치되어 있는지 확인하세요.
    pause
    exit /b 1
  )
)

echo  서버를 시작합니다...
echo  브라우저에서 http://127.0.0.1:3080 으로 접속하세요.
echo.
start "" "http://127.0.0.1:3080"
call npm start
pause

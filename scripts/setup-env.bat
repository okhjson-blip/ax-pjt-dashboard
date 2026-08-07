@echo off
chcp 65001 >nul
cd /d "%~dp0.."

if not exist .env (
  echo [.env] 파일이 없습니다. .env.example 을 복사합니다.
  copy .env.example .env >nul
  echo.
  echo  === 다음 단계 ===
  echo  1. Supabase Dashboard → Project Settings → API
  echo  2. .env 에 SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY 입력
  echo  3. 이 스크립트를 다시 실행하거나 npm start
  echo.
  notepad .env
  exit /b 0
)

echo.
echo  === 환경 점검 ===
findstr /B "SUPABASE_URL=" .env
findstr /B "SUPABASE_SERVICE_ROLE_KEY=" .env
echo.

echo 서버를 시작합니다...
call npm start

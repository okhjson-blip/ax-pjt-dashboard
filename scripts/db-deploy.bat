@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  === Supabase DB 배포 도우미 ===
echo.
echo  1) 프로젝트 목록 확인
echo  2) 프로젝트 연결 (link)
echo  3) 마이그레이션 배포 (db push)
echo  4) 시드 데이터 적용
echo  5) 종료
echo.

:menu
set /p CHOICE=번호 선택: 

if "%CHOICE%"=="1" goto list
if "%CHOICE%"=="2" goto link
if "%CHOICE%"=="3" goto push
if "%CHOICE%"=="4" goto seed
if "%CHOICE%"=="5" goto end
goto menu

:list
call supabase projects list
goto menu

:link
set /p REF=Project ref 입력: 
call supabase link --project-ref %REF% --yes
goto menu

:push
call supabase db push --linked --yes
goto menu

:seed
call supabase db query --linked -f supabase/seed.sql
goto menu

:end
echo 완료.

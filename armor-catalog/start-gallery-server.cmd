@echo off
setlocal
cd /d "%~dp0\.."
node armor-catalog\scripts\serve-site.mjs 4174

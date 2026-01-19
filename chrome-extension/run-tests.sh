#!/bin/bash

set -e

SCRIPT_DIR="/Users/lqj/cum10m/chrome-extension"
BACKUP_DIR="/Users/lqj/cum10m/chrome-extension.backup.20260115_165058"

check_structure() {
  echo "ℹ️  检查文件结构..."
  
  files=(
    "manifest.json"
    "background.js"
    "content.js"
    "popup.html"
    "popup.js"
    "options.html"
    "options.js"
    "core/logger.js"
    "core/storage.js"
    "core/ai-client.js"
    "core/action-executor.js"
    "utils/skills-loader.js"
    "test.html"
  )
  
  all_exist=true
  for file in "${files[@]}"; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
      echo "  ✓ $file"
    else
      echo "  ✗ $file 不存在"
      all_exist=false
    fi
  done
  
  if [ "$all_exist" = true ]; then
    echo "✅ 所有必需文件存在"
  else
    echo "❌ 部分文件缺失"
    exit 1
  fi
}

case "${1:-check}" in
  check)
    check_structure
    ;;
  help|--help|-h)
    echo "用法: ./run-tests.sh check"
    ;;
  *)
    echo "未知选项: $1"
    exit 1
    ;;
esac

#!/bin/bash

# 重新加载扩展

SCRIPT_DIR="/Users/lqj/cum10m/chrome-extension"

EXT_ID=$(grep '"id"' "$SCRIPT_DIR/manifest.json" 2>/dev/null || echo '')

if [ -z "$EXT_ID" ]; then
  echo "无法自动重新加载扩展"  
  echo "请手动操作："
  echo ""
  echo "1. 访问 chrome://extensions/"
  echo "2. 找到 'AI Browser Assistant'"
  echo "3. 点击刷新图标"
  echo ""
  return
fi

# 尝试通过 Chrome 远程调试重新加载
echo "尝试重新加载扩展..."

# macOS 上的 Chrome
if [ -d "/Applications/Google Chrome.app" ]; then
  osascript -e 'tell application "Google Chrome'
    if count of windows > 0 then
      set activeTab to active tab of first window
    end if
  end tell' 2>/dev/null || true
fi

echo "请手动刷新扩展："
echo "1. 访问 chrome://extensions/"
echo "2. 找到 'AI Browser Assistant'"
echo "3. 点击刷新图标 🔄"

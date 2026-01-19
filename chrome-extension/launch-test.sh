#!/bin/bash

# 快速启动测试

SCRIPT_DIR="/Users/lqj/cum10m/chrome-extension"

open "$SCRIPT_DIR/test.html"

echo ""
echo "测试页面已在浏览器中打开"
echo ""
echo "接下来请："
echo "1. 在 Chrome 中加载扩展（chrome://extensions/）"
echo "2. 点击扩展图标打开侧边栏"
echo "3. 开始测试各种功能"
echo ""
echo "详细测试指南参见: $SCRIPT_DIR/TEST_GUIDE.md"

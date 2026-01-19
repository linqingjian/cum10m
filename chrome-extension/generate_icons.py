#!/usr/bin/env python3
"""生成简单的 PNG 图标 - 纯 Python 实现"""
import struct
import zlib

def create_png(width, height, pixels):
    """创建 PNG 文件"""
    def png_chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + chunk_crc
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk (image data)
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter type
        for x in range(width):
            raw_data += bytes(pixels[y * width + x])
    
    compressed = zlib.compress(raw_data, 9)
    idat = png_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = png_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

def create_robot_icon(size):
    """创建简单的机器人图标"""
    pixels = []
    center = size // 2
    radius = size // 2 - 2
    
    for y in range(size):
        for x in range(size):
            # 计算到圆心的距离
            dx = x - center
            dy = y - center
            dist = (dx*dx + dy*dy) ** 0.5
            
            if dist <= radius:
                # 在圆内 - 渐变蓝色背景
                r = int(0 + (0 - 0) * dist / radius)
                g = int(217 - (217 - 150) * dist / radius)
                b = int(255 - (255 - 200) * dist / radius)
                a = 255
                
                # 眼睛区域
                eye_y = center - size // 6
                left_eye_x = center - size // 4
                right_eye_x = center + size // 4
                eye_radius = size // 8
                
                # 左眼
                left_dist = ((x - left_eye_x)**2 + (y - eye_y)**2) ** 0.5
                if left_dist <= eye_radius:
                    r, g, b = 255, 255, 255
                
                # 右眼
                right_dist = ((x - right_eye_x)**2 + (y - eye_y)**2) ** 0.5
                if right_dist <= eye_radius:
                    r, g, b = 255, 255, 255
                
                # 嘴巴（简单的弧形）
                mouth_y = center + size // 4
                if abs(y - mouth_y) < size // 10 and abs(x - center) < size // 4:
                    if (y - mouth_y) > -abs(x - center) * 0.3:
                        r, g, b = 255, 255, 255
                
                pixels.append([r, g, b, a])
            else:
                # 透明背景
                pixels.append([0, 0, 0, 0])
    
    return pixels

# 生成图标
for size in [16, 48, 128]:
    pixels = create_robot_icon(size)
    png_data = create_png(size, size, pixels)
    with open(f'icon{size}.png', 'wb') as f:
        f.write(png_data)
    print(f'Created icon{size}.png ({len(png_data)} bytes)')

print('Done!')

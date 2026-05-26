#!/usr/bin/env python3
"""PNG → Agentville SPRITES ASCII grid 변환.

빌드 타임 일회성 스크립트. 16×16 PNG 한 장을 읽어 `D L E M A B K` 팔레트 코드로
매핑된 16-row × 16-col 그리드 문자열을 출력한다. 결과를 그대로 `app.js` 의
SPRITES 객체에 붙여넣을 수 있게 한다.

## 사용법

    uv run tools/png_to_grid.py <species-name> sprite-base.png sprite-walk.png

또는 단일 프레임:

    uv run tools/png_to_grid.py <species-name> sprite.png

옵션:

    --palette default|monster|warm  : 픽셀 RGB → 코드 매핑 프로필
    --threshold 30                    : 색 클러스터링 거리 (LAB)
    --json                            : SPRITES 객체용 raw JSON 라인만 출력

## 팔레트 코드 매핑 (default)

    `.` = transparent (alpha < 32)
    `D` = darkest non-transparent color (outline)
    `L` = lightest body color (interior)
    `E` = eye 색 (작은 dot, 보통 검정 or 흰색)
    `M` = mouth 색
    `A` = accent (wing / horn / 강조)
    `B` = highlight / blush
    `K` = secondary outline (예: 다른 색의 뿔 / 꼬리 strip)

자동 매핑은 거의 항상 100% 정확하지 않다 — 결과를 그대로 쓰기보다 *seed* 로 보고
약간의 수동 보정 거의 필수. Kenney 등 limited-palette 자산은 5-8색만 쓰므로
대부분 깨끗하게 분리된다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _require_pillow():
    try:
        from PIL import Image
        return Image
    except ImportError:
        print("ERROR: Pillow 미설치. `uv pip install pillow` 또는 `pip install pillow`.", file=sys.stderr)
        sys.exit(2)


def _color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) ** 0.5


def _cluster_colors(pixels: list[tuple[int, int, int, int]], threshold: float = 30.0) -> list[tuple[int, int, int]]:
    """Alpha 가 충분히 높은 픽셀들을 모아 비슷한 RGB 끼리 클러스터링.

    Return: 유니크한 RGB 색 리스트 (등장 빈도 desc).
    """
    counts: dict[tuple[int, int, int], int] = {}
    for r, g, b, a in pixels:
        if a < 32:
            continue
        merged = False
        for ref in list(counts.keys()):
            if _color_distance((r, g, b), ref) < threshold:
                counts[ref] = counts.get(ref, 0) + 1
                merged = True
                break
        if not merged:
            counts[(r, g, b)] = 1
    return sorted(counts.keys(), key=lambda c: counts[c], reverse=True)


def _assign_palette(colors: list[tuple[int, int, int]]) -> dict[tuple[int, int, int], str]:
    """등장 빈도 + 밝기로 코드 자동 할당.

    L = 가장 밝음 (body), D = 가장 어두움 (outline). 나머지는 E M A B K 순.
    수동 보정 거의 필수 (특히 E/M).
    """
    if not colors:
        return {}
    # 빈도순 reverse — 가장 많은 색이 main body
    def luminance(c):
        r, g, b = c
        return 0.2126*r + 0.7152*g + 0.0722*b
    sorted_by_lum = sorted(colors, key=luminance)
    darkest = sorted_by_lum[0]
    lightest = sorted_by_lum[-1]
    assignment: dict[tuple[int, int, int], str] = {}
    assignment[darkest] = 'D'
    assignment[lightest] = 'L'
    # 중간 색들 — 빈도순으로 E M A B K
    middle_codes = ['E', 'M', 'A', 'B', 'K']
    middle = [c for c in colors if c != darkest and c != lightest]
    for i, c in enumerate(middle[:len(middle_codes)]):
        assignment[c] = middle_codes[i]
    return assignment


def png_to_grid(png_path: Path, palette_threshold: float = 30.0) -> tuple[list[str], list[str]]:
    """PNG → (grid_rows, debug_lines).

    grid_rows: 16개의 16-char 문자열 (top to bottom).
    debug_lines: 사람이 읽을 디버그 정보 (팔레트 매핑).
    """
    Image = _require_pillow()
    im = Image.open(png_path).convert("RGBA")
    if im.size != (16, 16):
        # 자동 다운샘플 (Kenney 자산이 32x32 이면 16x16 으로)
        if im.size[0] == im.size[1] and im.size[0] in (32, 48, 64):
            im = im.resize((16, 16), Image.NEAREST)
        else:
            print(f"WARN: {png_path} size {im.size} != 16×16, NEAREST 리사이즈 시도", file=sys.stderr)
            im = im.resize((16, 16), Image.NEAREST)

    pixels = [im.getpixel((x, y)) for y in range(16) for x in range(16)]
    unique_colors = _cluster_colors(pixels, threshold=palette_threshold)
    palette = _assign_palette(unique_colors)

    rows: list[str] = []
    for y in range(16):
        row_chars = []
        for x in range(16):
            r, g, b, a = im.getpixel((x, y))
            if a < 32:
                row_chars.append('.')
                continue
            # 가장 가까운 팔레트 색 찾기
            best_code = '.'
            best_dist = float('inf')
            for ref, code in palette.items():
                d = _color_distance((r, g, b), ref)
                if d < best_dist:
                    best_dist = d
                    best_code = code
            row_chars.append(best_code)
        rows.append(''.join(row_chars))

    debug = [f"# {png_path.name}", "# palette (auto-assigned, 수동 보정 권장):"]
    for c, code in palette.items():
        debug.append(f"#   {code} = rgb{c}")
    return rows, debug


def main():
    ap = argparse.ArgumentParser(description="PNG → SPRITES grid 변환")
    ap.add_argument("species", help="신규 SPRITES 키 (예: blob, dragon-baby)")
    ap.add_argument("pngs", nargs="+", type=Path, help="1-3 개 frame PNG")
    ap.add_argument("--threshold", type=float, default=30.0)
    ap.add_argument("--json", action="store_true", help="SPRITES JS literal 형식으로 출력")
    args = ap.parse_args()

    all_frames = []
    for png in args.pngs:
        rows, debug = png_to_grid(png, palette_threshold=args.threshold)
        if not args.json:
            print('\n'.join(debug))
        all_frames.append(rows)

    if args.json:
        # SPRITES["species"] = [[...frame1...], [...frame2...]] 형식
        out = f"  {args.species!r}: ["
        for i, frame in enumerate(all_frames):
            out += "[\n"
            for r in frame:
                out += f"    {r!r},\n"
            out += "  ]"
            if i < len(all_frames) - 1:
                out += ", "
        out += "],"
        print(out)
    else:
        print(f"\n# === {args.species} ===")
        for i, frame in enumerate(all_frames):
            print(f"# frame {i + 1}:")
            for r in frame:
                print(f'    {r!r},')
            print()


if __name__ == "__main__":
    main()

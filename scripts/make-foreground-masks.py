"""Rebuild the 1:1 alpha masks from the original paintings (Python + Pillow)."""

from pathlib import Path

from PIL import Image, ImageDraw

ART = Path(__file__).resolve().parents[1] / 'public' / 'art'
X0, Y0, WIDTH, HEIGHT = 480, 350, 1350, 150

# The rail rises and falls independently of the walker's feet. These contours
# sit on the near edge of the top rail; big posts extend above them.
DECK_RAIL = {
    'day': [(1112, 461), (1140, 447), (1170, 432), (1200, 420), (1240, 404),
            (1306, 393), (1366, 387), (1422, 387), (1478, 391), (1536, 397),
            (1592, 404), (1630, 419), (1661, 435), (1690, 449), (1716, 462)],
    'dusk': [(1109, 461), (1137, 448), (1166, 434), (1197, 420), (1237, 405),
             (1303, 393), (1364, 388), (1420, 388), (1476, 391), (1534, 397),
             (1588, 405), (1627, 419), (1658, 435), (1687, 449), (1713, 463)],
    'night': [(1117, 464), (1145, 450), (1174, 434), (1206, 419), (1246, 403),
              (1310, 393), (1376, 387), (1430, 387), (1487, 392), (1541, 398),
              (1600, 406), (1637, 421), (1669, 437), (1698, 452), (1724, 464)],
}
# (post centre, finial/lamp top, half-width), measured in each original.
DECK_POSTS = {
    'day': [(1112, 453, 4), (1140, 441, 4), (1169, 423, 4), (1200, 392, 9),
            (1242, 376, 10), (1273, 389, 4), (1309, 364, 11), (1366, 379, 5),
            (1422, 379, 5), (1478, 364, 11), (1537, 388, 6), (1591, 386, 9),
            (1629, 395, 8), (1662, 423, 5), (1691, 442, 5), (1716, 456, 4)],
    'dusk': [(1109, 453, 4), (1137, 441, 4), (1166, 425, 4), (1197, 393, 9),
             (1238, 378, 10), (1270, 391, 4), (1305, 364, 11), (1364, 379, 5),
             (1420, 379, 5), (1475, 363, 11), (1534, 389, 6), (1588, 387, 9),
             (1627, 396, 8), (1659, 424, 5), (1687, 444, 5), (1712, 457, 4)],
    'night': [(1117, 455, 4), (1145, 442, 4), (1174, 425, 4), (1206, 394, 8),
              (1246, 373, 9), (1279, 390, 4), (1315, 360, 9), (1372, 360, 7),
              (1428, 361, 7), (1485, 360, 10), (1543, 376, 7), (1597, 387, 8),
              (1638, 396, 8), (1669, 426, 5), (1696, 442, 5), (1723, 455, 5)],
}

# The path is behind this strip of bank planting. Trace its irregular edge
# separately from the stonework so the larger openings between leaves remain.
PLANT_EDGE = [(711, 483), (719, 476), (725, 469), (734, 473), (743, 464),
              (755, 470), (764, 460), (775, 467), (786, 463), (793, 470),
              (803, 455), (816, 462), (830, 458), (843, 465), (856, 460),
              (864, 469), (871, 463), (883, 469), (898, 464), (908, 472),
              (920, 463), (928, 470), (937, 466), (945, 473), (955, 477),
              (967, 474), (975, 468), (987, 470), (991, 464), (1000, 471),
              (1012, 466), (1023, 470), (1032, 464), (1043, 473), (1058, 480)]
WILLOWS = [
    [(611, 488), (615, 475), (620, 456), (626, 432), (632, 418),
     (638, 421), (633, 437), (628, 458), (623, 479), (623, 489)],
    [(1772, 475), (1776, 465), (1783, 444), (1788, 426), (1793, 420),
     (1797, 424), (1793, 443), (1788, 461), (1780, 476)],
]


def interpolate(points, x):
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        if x <= bx:
            return ay + (by - ay) * (x - ax) / (bx - ax)
    return points[-1][1]


def smooth(start, end, value):
    t = max(0, min(1, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def make_mask(variant):
    painting = Image.open(ART / f'scene-{variant}.webp').convert('RGB')
    assert painting.size == (2172, 724)
    rgb = painting.crop((X0, Y0, X0 + WIDTH, Y0 + HEIGHT)).load()
    alpha = Image.new('L', (WIDTH, HEIGHT))
    pixels = alpha.load()
    low, high = {'day': (125, 180), 'dusk': (112, 169), 'night': (77, 127)}[variant]

    def trace_rail(edge, posts, base_depth, solid_depth):
        for x in range(edge[0][0], edge[-1][0] + 1):
            sx = x - X0
            rail_y = interpolate(edge, x)
            post_top = min((top for cx, top, half in posts if abs(x - cx) <= half),
                           default=rail_y)
            for y in range(min(round(rail_y), round(post_top)) - 1, round(rail_y + base_depth) + 1):
                sy = y - Y0
                r, g, b = rgb[sx, sy]
                # The painted holes are mostly dark foliage. Gate by colour
                # only inside the traced rail/post bounds, never on open water.
                light = (3 * r + 6 * g + b) / 10
                stone = smooth(low, high, light) * smooth(-20, 2, r - g)
                base = smooth(rail_y + solid_depth, rail_y + solid_depth + 2, y)
                coverage = max(base, stone) * smooth(rail_y + base_depth + 1, rail_y + base_depth - 2, y)
                pixels[sx, sy] = max(pixels[sx, sy], round(coverage * 255))

    offset = {'day': 0, 'dusk': -2, 'night': 2}[variant]
    trace_rail([(480, 469 + offset / 2), (712, 469 + offset / 2)],
               [(x + offset, 463, 4) for x in (491, 516, 544, 571, 596, 634, 661, 686, 712)], 15, 7)
    trace_rail([(1039, 465), (1119, 466 + offset / 2)],
               [(x + offset, 458, 4) for x in (1045, 1074, 1087, 1112)], 16, 7)
    trace_rail(DECK_RAIL[variant], DECK_POSTS[variant], 31, 17)
    trace_rail([(1714, 465), (1776, 466), (1818, 467)],
               [(x + offset, 457, 4) for x in (1728, 1748, 1775, 1799, 1812)], 15, 8)

    for x in range(PLANT_EDGE[0][0], PLANT_EDGE[-1][0] + 1):
        top = interpolate(PLANT_EDGE, x) - offset
        for y in range(int(top), 488):
            sx, sy = x - X0, y - Y0
            pixels[sx, sy] = max(pixels[sx, sy], round(255 * smooth(top, top + 3, y)))

    draw = ImageDraw.Draw(alpha)
    for trunk in WILLOWS:
        draw.polygon([(x + offset - X0, y - Y0) for x, y in trunk], fill=255)

    rgba = Image.new('RGBA', alpha.size, 'white')
    rgba.putalpha(alpha)
    target = ART / f'foreground-mask-{variant}.webp'
    rgba.save(target, lossless=True, method=6)
    print(f'{target.name}: {target.stat().st_size:,} bytes')


if __name__ == '__main__':
    for variant in DECK_RAIL:
        make_mask(variant)
